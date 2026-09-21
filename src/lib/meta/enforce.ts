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
 *   - IT IS OFF UNLESS SWITCHED ON. `AUTO_PAUSE=true` in .env, and nothing
 *     happens without it.
 *
 * It runs inside the dev server process, so it only acts while that server is
 * running. That is a real limitation and is surfaced rather than hidden: a
 * laptop that is closed does not pause anything.
 */

import { desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { auditLog } from "../db/schema";
import { newId } from "../id";
import { GraphError, graphPost } from "./graph";
import { getCityLeadsThisMonth } from "./city-leads";
import { fetchLeadTargets } from "../sheets/lead-targets";
import { currentMonthRange } from "./city-leads";

/**
 * What auto-pause did, in the database.
 *
 * It used to be a JSONL file under the app directory. On Vercel that filesystem
 * is read-only and discarded between invocations, so every record either failed
 * to write or vanished - and the reader swallowed the error and returned an
 * empty list. The history read as "auto-pause has never done anything" whether
 * it had paused ten campaigns that morning or never run at all, which is the
 * one thing this log exists to prevent.
 */
const PAUSE_ACTION = "AUTO_PAUSE";

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

export async function recordPause(record: PauseRecord, accountId?: string): Promise<void> {
  try {
    await db.insert(auditLog).values({
      id: newId("audit"),
      at: new Date(record.at),
      accountId: accountId ?? null,
      action: PAUSE_ACTION,
      subject: record.cityName,
      // The whole record, so the history can show the figures the decision was
      // made on rather than only its conclusion. "Paused Mohali" is not
      // reviewable; "paused Mohali at 6,510 against a 6,500 budget" is.
      detail: JSON.stringify(record),
      ok: record.failed.length === 0,
    });
  } catch (err) {
    // A failed log must not undo a pause that has already happened - but it
    // must be loud, because a silent logging failure is what hid this.
    console.error("[auto-pause] could not write the pause log:", err instanceof Error ? err.message : err);
  }
}

export async function readPauseLog(limit = 50): Promise<PauseRecord[]> {
  try {
    const rows = await db
      .select({ detail: auditLog.detail })
      .from(auditLog)
      .where(eq(auditLog.action, PAUSE_ACTION))
      .orderBy(desc(auditLog.at))
      .limit(limit);
    return rows
      .map((r) => {
        try {
          return r.detail ? (JSON.parse(r.detail) as PauseRecord) : null;
        } catch {
          return null;
        }
      })
      .filter((r): r is PauseRecord => r !== null);
  } catch (err) {
    // Returning [] on a read failure is how "the log is unreadable" came to
    // look identical to "nothing has ever been paused". It is still the only
    // safe return value, but it is no longer silent.
    console.error("[auto-pause] could not read the pause log:", err instanceof Error ? err.message : err);
    return [];
  }
}

export function autoPauseEnabled(): boolean {
  return process.env.AUTO_PAUSE?.trim() === "true";
}

export interface EnforceResult {
  ran: boolean;
  /** Why nothing was done, when nothing was. */
  skipped: string | null;
  paused: PauseRecord[];
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
  const out: EnforceResult = { ran: false, skipped: null, paused: [], refused: [], checkedAt };

  if (process.env.USE_MOCK_META !== "false" || !process.env.META_ACCESS_TOKEN?.trim()) {
    out.skipped = "Not in live mode.";
    return out;
  }

  const adAccountId = account.id;

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

  return out;
}
