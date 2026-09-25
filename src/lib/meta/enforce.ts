/**
 * Stopping a city automatically when it has spent its budget or hit its target.
 *
 * This is the only place in the app that changes the ad account without a
 * person present, so it is built to be distrusted:
 *
 *   - IT REFUSES MORE READILY THAN IT ACTS. Every reason to doubt the numbers
 *     is a reason not to pause. A sheet that failed to load, a Meta read that
 *     errored, a city with spend but zero leads, a target that looks like a
 *     typo — each aborts that city rather than guessing. The cost of a missed
 *     pause is some overspend; the cost of a wrong pause is a market switched
 *     off with nobody watching.
 *   - IT WRITES DOWN WHAT IT DID, ALWAYS, INCLUDING THE NUMBERS THAT JUSTIFIED
 *     IT. An automated action nobody can reconstruct later is indistinguishable
 *     from a bug.
 *   - IT IS OFF UNLESS SWITCHED ON. `AUTO_PAUSE=true` in the environment, and
 *     nothing happens without it. Restarting a city has its OWN switch,
 *     `AUTO_RESUME=true` — see `autoResumeEnabled` for why the two are not one.
 *
 * It runs from a scheduled job (`/api/cron/enforce`, once a day), not from a
 * timer inside a process: on serverless the instance is frozen the moment it
 * responds, so an in-process timer never fires. Nothing enforces anything if
 * that schedule is not configured, however armed the interface looks.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { auditLog } from "../db/schema";
import { newId } from "../id";
import { GraphError, graphGet, graphPost } from "./graph";
import { cooldownRemaining } from "./throttle";
import { getCityLeadsThisMonth } from "./city-leads";
import { fetchLeadTargets } from "../sheets/lead-targets";
import { currentMonthRange } from "./city-leads";

/**
 * What auto-pause did, in the database.
 *
 * It used to be a JSONL file under the app directory. On Vercel that filesystem
 * is read-only and discarded between invocations, so every record either failed
 * to write or vanished — and the reader swallowed the error and returned an
 * empty list. The history read as "auto-pause has never done anything" whether
 * it had paused ten campaigns that morning or never run at all, which is the
 * one thing this log exists to prevent.
 */
const PAUSE_ACTION = "AUTO_PAUSE";

/**
 * And what auto-RESUME did.
 *
 * A separate action, not a flag on the pause record, because the two are asked
 * about separately: "what did it stop" and "what did it start again" are
 * different questions, and the second is the one that costs money.
 */
const RESUME_ACTION = "AUTO_RESUME";

export interface PauseRecord {
  at: string;
  cityName: string;
  reason: "BUDGET" | "TARGET";
  leads: number;
  target: number | null;
  spend: number;
  budget: number | null;
  since: string;
  until: string;
  campaigns: { campaignId: string; campaignName: string }[];
  paused: string[];
  failed: { campaignId: string; error: string }[];
  /** "auto" when the scheduler did it; "manual" when a person clicked. */
  trigger: "auto" | "manual";
}

/**
 * Why a campaign was switched back on.
 *
 * The evidence is the two figures side by side — the limit in the sheet when
 * Cruise stopped the city, and the limit in the sheet now. A resume is only
 * ever justified by somebody having raised one of them, so the record has to
 * carry both or it cannot be checked.
 */
export interface ResumeRecord {
  at: string;
  cityName: string;
  reason: "BUDGET_RAISED" | "TARGET_RAISED";
  /** When the pause this undoes happened. */
  pausedAt: string;
  leads: number;
  spend: number;
  /** The sheet's figures at pause time, and now. */
  budgetWas: number | null;
  budget: number | null;
  targetWas: number | null;
  target: number | null;
  since: string;
  until: string;
  campaigns: { campaignId: string; campaignName: string }[];
  resumed: string[];
  failed: { campaignId: string; error: string }[];
  trigger: "auto" | "manual";
}

async function writeAudit(
  action: string,
  subject: string,
  detail: unknown,
  ok: boolean,
  accountId?: string
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      id: newId("audit"),
      at: new Date(),
      accountId: accountId ?? null,
      action,
      subject,
      // The whole record, so the history can show the figures the decision was
      // made on rather than only its conclusion. "Paused Mohali" is not
      // reviewable; "paused Mohali at ₹6,510 against a ₹6,500 budget" is.
      detail: JSON.stringify(detail),
      ok,
    });
  } catch (err) {
    // A failed log must not undo an action that has already happened — but it
    // must be loud, because a silent logging failure is what hid this for a
    // fortnight.
    console.error(`[${action}] could not write the log:`, err instanceof Error ? err.message : err);
  }
}

async function readAudit<T>(action: string, limit: number, accountId?: string): Promise<T[]> {
  try {
    const rows = await db
      .select({ detail: auditLog.detail })
      .from(auditLog)
      .where(accountId ? and(eq(auditLog.action, action), eq(auditLog.accountId, accountId)) : eq(auditLog.action, action))
      .orderBy(desc(auditLog.at))
      .limit(limit);
    return rows
      .map((r) => {
        try {
          return r.detail ? (JSON.parse(r.detail) as T) : null;
        } catch {
          return null;
        }
      })
      .filter((r): r is T => r !== null);
  } catch (err) {
    // Returning [] on a read failure is how "the log is unreadable" came to
    // look identical to "nothing has ever been paused". It is still the only
    // safe return value, but it is no longer silent.
    console.error(`[${action}] could not read the log:`, err instanceof Error ? err.message : err);
    return [];
  }
}

export async function recordPause(record: PauseRecord, accountId?: string): Promise<void> {
  await writeAudit(PAUSE_ACTION, record.cityName, record, record.failed.length === 0, accountId);
}

export async function readPauseLog(limit = 50, accountId?: string): Promise<PauseRecord[]> {
  return readAudit<PauseRecord>(PAUSE_ACTION, limit, accountId);
}

export async function recordResume(record: ResumeRecord, accountId?: string): Promise<void> {
  await writeAudit(RESUME_ACTION, record.cityName, record, record.failed.length === 0, accountId);
}

export async function readResumeLog(limit = 50, accountId?: string): Promise<ResumeRecord[]> {
  return readAudit<ResumeRecord>(RESUME_ACTION, limit, accountId);
}

export function autoPauseEnabled(): boolean {
  return process.env.AUTO_PAUSE?.trim() === "true";
}

/**
 * Resuming is a SEPARATE switch from pausing, and off by default.
 *
 * Not tidiness — a different decision. Pausing saves money and its worst case
 * is a market that stops earning for a day. Resuming spends money, its worst
 * case is a campaign running unattended against a budget nobody meant to raise,
 * and it acts on campaigns that are currently off, which is the state a person
 * is most likely to have put them in on purpose. The two should not be armed by
 * one flag, because somebody arming the safe one would silently get the other.
 */
export function autoResumeEnabled(): boolean {
  return process.env.AUTO_RESUME?.trim() === "true";
}

export interface EnforceResult {
  ran: boolean;
  /** Why nothing was done, when nothing was. */
  skipped: string | null;
  paused: PauseRecord[];
  /** Campaigns switched back on because the sheet gave them room again. */
  resumed: ResumeRecord[];
  /** Cities that met a threshold but were deliberately not touched, and why. */
  refused: { cityName: string; reason: string }[];
  checkedAt: string;
}

/**
 * Check every city and pause the ones that are done.
 *
 * `trigger` is recorded so the log distinguishes what a person did from what
 * the scheduler did — the first question anyone asks about a paused campaign is
 * "who stopped this".
 */
/**
 * @param account the account to enforce. Auto-pause is per account because the
 * lead targets are: each account has its own sheet, or no sheet at all, and an
 * account with no sheet has nothing to enforce rather than a limit of zero.
 */
export async function enforceLimits(
  trigger: "auto" | "manual",
  account: { id: string; name: string; leadTargetsCsvUrl: string | null; conversionEvent: string | null }
): Promise<EnforceResult> {
  const checkedAt = new Date().toISOString();
  const out: EnforceResult = { ran: false, skipped: null, paused: [], resumed: [], refused: [], checkedAt };

  if (process.env.USE_MOCK_META !== "false" || !process.env.META_ACCESS_TOKEN?.trim()) {
    out.skipped = "Not in live mode.";
    return out;
  }

  const adAccountId = account.id;

  // The scheduled sweep does not go through requireAccount, so nothing else
  // stops it calling an account Meta has already blocked — and a call made
  // while blocked rolls the window forward, which is how an account stays
  // blocked. Skipping is safe: the worst case is one day's enforcement missed
  // on an account that cannot be read anyway.
  const cooling = await cooldownRemaining(adAccountId);
  if (cooling > 0) {
    out.skipped =
      `Meta has this ad account rate-limited for about ${Math.ceil(cooling / 60000)} more minutes, so nothing was ` +
      `read and nothing was paused. Calling it now would only extend the block.`;
    return out;
  }

  // --- the two inputs. Either failing means we do not know enough to act. ---
  let sheet;
  try {
    sheet = await fetchLeadTargets(account.leadTargetsCsvUrl ?? undefined);
  } catch (err) {
    out.skipped = `Sheet unreadable, so nothing was paused: ${err instanceof Error ? err.message : String(err)}`;
    return out;
  }
  if (sheet.targets.length === 0) {
    out.skipped = "The sheet has no usable rows, so nothing was paused.";
    return out;
  }

  const range = currentMonthRange();
  let actuals;
  try {
    actuals = await getCityLeadsThisMonth(adAccountId, range);
  } catch (err) {
    out.skipped = `Meta unreadable, so nothing was paused: ${
      err instanceof GraphError ? err.describe() : err instanceof Error ? err.message : String(err)
    }`;
    return out;
  }

  out.ran = true;
  const actualByCity = new Map(actuals.cities.map((c) => [c.cityName.toLowerCase(), c]));

  for (const t of sheet.targets) {
    const a = actualByCity.get(t.cityName.toLowerCase());
    if (!a) continue; // nothing delivering; nothing to stop

    const spend = Math.round(a.spend);
    const overBudget = t.budget !== null && spend >= t.budget;
    const overTarget = t.target !== null && a.leads >= t.target;
    if (!overBudget && !overTarget) continue;

    const reason: "BUDGET" | "TARGET" = overBudget ? "BUDGET" : "TARGET";

    // --- the refusals -----------------------------------------------------
    // Spend with no leads at all is the signature of a broken lead count, not
    // of a city that genuinely converted nothing. Pausing on a target when the
    // count may be wrong is exactly the mistake to avoid.
    if (reason === "TARGET" && a.leads > 0 && spend === 0) {
      out.refused.push({
        cityName: t.cityName,
        reason: "Reports leads but no spend — the figures disagree, so it was left running.",
      });
      continue;
    }
    // A target so small that any delivery clears it reads like a typo.
    if (reason === "TARGET" && t.target !== null && t.target < 5) {
      out.refused.push({
        cityName: t.cityName,
        reason: `Target of ${t.target} is small enough to look like a typo, so it was left running.`,
      });
      continue;
    }

    // A consolidated campaign covers several cities under one ad set and one
    // budget. Pausing it because THIS city finished would stop cities that have
    // target left and never agreed to stop. Auto-pause acts on campaigns, so
    // the only safe thing is to leave these alone and say so.
    const consolidated = new Set(actuals.multiCityCampaignIds ?? []);
    const shared = a.campaigns.filter((c) => consolidated.has(c.campaignId));
    if (shared.length > 0) {
      out.refused.push({
        cityName: t.cityName,
        reason: `${shared.map((c) => c.campaignName).join(", ")} ${shared.length === 1 ? "covers" : "cover"} several cities under one ad set. Pausing ${shared.length === 1 ? "it" : "them"} would stop the other cities too, so ${shared.length === 1 ? "it was" : "they were"} left running — watch ${shared.length === 1 ? "its" : "their"} budget by hand.`,
      });
    }

    const active = a.campaigns.filter((c) => c.status === "ACTIVE" && !consolidated.has(c.campaignId));
    if (active.length === 0) continue; // already stopped, or all consolidated

    const paused: string[] = [];
    const failed: { campaignId: string; error: string }[] = [];
    for (const c of active) {
      try {
        await graphPost(c.campaignId, { status: "PAUSED" });
        paused.push(c.campaignId);
      } catch (err) {
        failed.push({
          campaignId: c.campaignId,
          error: err instanceof GraphError ? err.describe() : err instanceof Error ? err.message : String(err),
        });
      }
    }

    const record: PauseRecord = {
      at: new Date().toISOString(),
      cityName: t.cityName,
      reason,
      leads: a.leads,
      target: t.target,
      spend,
      budget: t.budget,
      since: range.since,
      until: range.until,
      campaigns: active.map((c) => ({ campaignId: c.campaignId, campaignName: c.campaignName })),
      paused,
      failed,
      trigger,
    };
    await recordPause(record, account.id);
    out.paused.push(record);

    console.log(
      `[auto-pause] ${t.cityName}: paused ${paused.length} campaign(s) — ${reason === "BUDGET" ? `spend ₹${spend} of ₹${t.budget}` : `${a.leads} of ${t.target} leads`}`
    );
  }

  if (autoResumeEnabled()) {
    await resumeWhereTheSheetGaveRoom({
      account,
      sheet,
      actualByCity,
      range,
      trigger,
      out,
      // A city stopped seconds ago in this same sweep is not a candidate for
      // being started again in it.
      justPaused: new Set(out.paused.map((p) => p.cityName.toLowerCase())),
    });
  }

  return out;
}

/**
 * How much of a raised budget must still be unspent before a city is restarted.
 *
 * Without a floor, raising a ₹6,500 budget to ₹6,600 on a city that has spent
 * ₹6,531 would switch the campaigns on, let them spend ₹70, and stop them again
 * the next morning — a day of churn, two log entries and a learning phase
 * thrown away, for an hour of delivery. Five per cent is not a magic number; it
 * is "enough room to be worth restarting for", and a city below it is reported
 * as refused rather than quietly skipped.
 */
const MIN_HEADROOM = 0.05;

/**
 * Switch back on what Cruise itself switched off, once the sheet gives it room.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NARROWER THAN THE PAUSER
 *
 * Pausing is reversible by one click and saves money while it is wrong.
 * Resuming spends money, and it acts on campaigns that are OFF — which is the
 * state somebody is most likely to have chosen deliberately. So every rule here
 * is about proving that this particular campaign is off because Cruise turned
 * it off, and that a person has since decided it should run again:
 *
 *   1. ONLY OUR OWN PAUSES. The campaign must appear in an AUTO_PAUSE record
 *      for THIS account. Meta does not record who paused a campaign in anything
 *      we read, so a campaign Cruise cannot prove it paused is one a person
 *      paused as far as this code is concerned.
 *   2. ONLY THIS MONTH'S. Budgets and spend are month-to-date. On the 1st,
 *      every city is suddenly under budget again — without this, a month
 *      rollover would restart everything ever paused, all at once, unattended.
 *      A new month should start campaigns because a person started them.
 *   3. ONLY WHEN THE LIMIT WAS RAISED. Under-budget is not enough: spend can
 *      fall below a budget because Meta restated a figure, or because the sheet
 *      was re-read. The sheet's number must be strictly HIGHER than the number
 *      that justified the pause. That is the signal, and it is a deliberate
 *      human act — which is exactly what "revise the spend in the sheet" means.
 *   4. BOTH DOORS OPEN. A city under budget but over target would be paused
 *      again by the next sweep, so it is not resumed.
 *   5. STILL PAUSED, CHECKED AGAINST META. If it is already ACTIVE somebody
 *      restarted it by hand and there is nothing to do; if it is ARCHIVED it is
 *      not ours to revive.
 *
 * What it cannot prove: that nobody paused the campaign AGAIN, by hand, after
 * Cruise paused it. Meta reports one status, not a history, and reading the
 * account's activity log for every candidate would cost a sweep of calls on
 * accounts that already spend days inside their own rate limit. Rule 3 is the
 * guard that makes this acceptable — a resume only ever follows somebody typing
 * a bigger number into the sheet — and it is why this is behind its own switch.
 * ---------------------------------------------------------------------------
 */
async function resumeWhereTheSheetGaveRoom(args: {
  account: { id: string; name: string };
  sheet: { targets: { cityName: string; target: number | null; budget: number | null }[] };
  actualByCity: Map<string, { leads: number; spend: number }>;
  range: { since: string; until: string };
  trigger: "auto" | "manual";
  out: EnforceResult;
  justPaused: Set<string>;
}): Promise<void> {
  const { account, sheet, actualByCity, range, trigger, out, justPaused } = args;

  const history = await readPauseLog(200, account.id);
  if (history.length === 0) return;

  // Newest first, so the first record seen for a city is the pause that is
  // currently in force. An older one describes a state already undone.
  const latestByCity = new Map<string, PauseRecord>();
  for (const r of history) {
    if (r.since !== range.since) continue; // rule 2: a different month's ceiling
    const key = r.cityName.toLowerCase();
    if (!latestByCity.has(key)) latestByCity.set(key, r);
  }

  for (const t of sheet.targets) {
    const key = t.cityName.toLowerCase();
    if (justPaused.has(key)) continue;

    const prior = latestByCity.get(key);
    if (!prior || prior.paused.length === 0) continue; // rule 1

    const a = actualByCity.get(key);
    // No delivery row this month means nothing to measure against. The pause
    // record's own figures are the honest fallback — and they are, by
    // definition, over the limit, so the city is left alone.
    const spend = a ? Math.round(a.spend) : prior.spend;
    const leads = a ? a.leads : prior.leads;

    // --- rule 4: everything that could stop it must be clear ---------------
    if (t.budget !== null && spend >= t.budget) continue;
    if (t.target !== null && leads >= t.target) continue;

    // --- rule 3: somebody raised the limit ---------------------------------
    const budgetRaised = t.budget !== null && prior.budget !== null && t.budget > prior.budget;
    const targetRaised = t.target !== null && prior.target !== null && t.target > prior.target;
    if (!budgetRaised && !targetRaised) continue;

    if (budgetRaised) {
      const headroom = t.budget! - spend;
      if (headroom < t.budget! * MIN_HEADROOM) {
        out.refused.push({
          cityName: t.cityName,
          reason:
            `Budget was raised to ₹${t.budget!.toLocaleString("en-IN")} but ₹${spend.toLocaleString("en-IN")} is ` +
            `already spent, leaving ₹${headroom.toLocaleString("en-IN")} — too little to be worth restarting for, ` +
            `since it would stop again within the day. Raise it further to restart this city.`,
        });
        continue;
      }
    }

    // --- rule 5: is it still off, and off in a way we can undo? ------------
    const candidates = prior.campaigns.filter((c) => prior.paused.includes(c.campaignId));
    const resumed: string[] = [];
    const failed: { campaignId: string; error: string }[] = [];
    const acted: { campaignId: string; campaignName: string }[] = [];

    for (const c of candidates) {
      let status: string | undefined;
      try {
        status = (await graphGet<{ status?: string }>(c.campaignId, { fields: "status" })).status;
      } catch (err) {
        failed.push({
          campaignId: c.campaignId,
          error: err instanceof GraphError ? err.describe() : err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      // ACTIVE: a person already restarted it. ARCHIVED or DELETED: not ours to
      // revive. Either way, nothing to do and nothing to report as a failure.
      if (status !== "PAUSED") continue;

      acted.push(c);
      try {
        await graphPost(c.campaignId, { status: "ACTIVE" });
        resumed.push(c.campaignId);
      } catch (err) {
        failed.push({
          campaignId: c.campaignId,
          error: err instanceof GraphError ? err.describe() : err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (acted.length === 0 && failed.length === 0) continue; // nothing was still paused

    const record: ResumeRecord = {
      at: new Date().toISOString(),
      cityName: t.cityName,
      reason: budgetRaised ? "BUDGET_RAISED" : "TARGET_RAISED",
      pausedAt: prior.at,
      leads,
      spend,
      budgetWas: prior.budget,
      budget: t.budget,
      targetWas: prior.target,
      target: t.target,
      since: range.since,
      until: range.until,
      campaigns: acted,
      resumed,
      failed,
      trigger,
    };
    await recordResume(record, account.id);
    out.resumed.push(record);

    console.log(
      `[auto-resume] ${t.cityName}: restarted ${resumed.length} campaign(s) — ` +
        (budgetRaised
          ? `budget raised ₹${prior.budget} → ₹${t.budget}, spent ₹${spend}`
          : `target raised ${prior.target} → ${t.target}, ${leads} leads`)
    );
  }
}
