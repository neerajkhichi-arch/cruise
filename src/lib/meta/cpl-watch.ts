/**
 * Campaigns whose cost per result has risen — and whether that is news.
 *
 * ---------------------------------------------------------------------------
 * THE DISTINCTION THIS EXISTS TO MAKE
 *
 * "CPL is up 40%" is not by itself a finding. A campaign whose daily budget was
 * cut in half will usually show a higher CPL: it drops out of the auctions it
 * was winning cheaply, its delivery narrows, and the learning it had is spent.
 * That is the predictable consequence of a decision somebody already made. An
 * alert about it tells the person who made the cut something they knew, and
 * every such alert makes the next one easier to ignore.
 *
 * What IS news is a campaign holding the same spend and paying more for each
 * result. Nobody decided that; the auction did. So before anything is raised,
 * the change in spend is measured alongside the change in cost, and the two are
 * reported together:
 *
 *   spend flat, cost up      -> ATTENTION. Something changed that nobody chose.
 *   spend down, cost up      -> EXPECTED. The cut explains it. Not an alert.
 *   spend up, cost up        -> SCALING. The cost of buying more volume; worth
 *                               seeing, worth deciding about, not an alarm.
 *
 * WINDOWS
 *
 * The baseline is the campaign's own recent history — about three months —
 * rather than a target or an account average. A campaign is compared with
 * itself, because a ₹200 CPL is excellent in one vertical and terrible in
 * another, and the person reading this already knows which is which.
 *
 * Both windows end YESTERDAY. Today is a partial day, and a half-day of
 * delivery makes cost per result look like it collapsed.
 *
 * EVIDENCE
 *
 * Under ten results in the baseline, a cost per result is noise, and a ratio of
 * two noisy numbers is worse. Those campaigns are reported as having too little
 * history rather than being silently dropped — "why is this one not here" needs
 * an answer, or the list cannot be trusted to be complete.
 * ---------------------------------------------------------------------------
 */

import { getLiveCampaignMetrics } from "./campaign-insights";
import { cached } from "./cache";
import { addDays, todayInAccountTz } from "../date-range";
import type { CampaignMetrics } from "../engine/types";

/** The recent window under examination. */
const RECENT_DAYS = 7;
/** Roughly three months of the campaign's own history, ending before the recent window. */
const BASELINE_DAYS = 90;
/** Below this, a cost per result is noise and a comparison of two is worse. */
const MIN_BASELINE_RESULTS = 10;
/** A rise smaller than this is ordinary week-to-week movement. */
const CPL_RISE = 0.25;
/**
 * How much average daily spend may move before the change is treated as a
 * deliberate budget decision rather than noise.
 */
const SPEND_TOLERANCE = 0.15;

export type Verdict =
  /** Spend held, cost rose. The one that deserves attention. */
  | "ATTENTION"
  /** Cost rose because spend was cut. Explained, not raised. */
  | "EXPECTED_AFTER_CUT"
  /** Cost rose while buying more volume. Worth a decision, not an alarm. */
  | "SCALING"
  /** Cost is not materially up. */
  | "STEADY"
  /** Not enough history to say anything honest. */
  | "TOO_LITTLE_HISTORY";

export interface Window {
  since: string;
  until: string;
  spend: number;
  results: number;
  cpl: number;
  /** Spend per day, which is what makes two windows of different length comparable. */
  dailySpend: number;
}

export interface CplWatchRow {
  campaignId: string;
  name: string;
  status: string;
  cities: string[];
  resultType: string;
  /** What the results were counted from, so a figure can be checked in Ads Manager. */
  resultAction?: string | null;
  baseline: Window;
  recent: Window;
  /** Change in cost per result, as a fraction. 0.4 means 40% more expensive. */
  cplChange: number | null;
  /** Change in spend per day, as a fraction. -0.5 means half the daily spend. */
  spendChange: number | null;
  verdict: Verdict;
  /** One line a person can act on, or forward. */
  summary: string;
}

export interface CplWatchResult {
  baselineWindow: { since: string; until: string };
  recentWindow: { since: string; until: string };
  /** Verdict ATTENTION, worst first. The list this feature exists for. */
  attention: CplWatchRow[];
  /** Everything examined, for the screen that wants the whole picture. */
  rows: CplWatchRow[];
  notes: string[];
}

const pct = (n: number) => `${Math.round(Math.abs(n) * 100)}%`;

function windowOf(m: CampaignMetrics | undefined, since: string, until: string, days: number): Window {
  const spend = m?.spend ?? 0;
  const results = m?.leads ?? 0;
  return {
    since,
    until,
    spend,
    results,
    cpl: results > 0 ? spend / results : 0,
    dailySpend: days > 0 ? spend / days : 0,
  };
}

/**
 * Compare each campaign with its own recent history.
 *
 * Both windows are read through `getLiveCampaignMetrics`, so results are
 * counted exactly as the Campaigns screen counts them — per campaign, by what
 * that campaign optimises for. Two screens disagreeing about the same campaign
 * is worse than either being slightly wrong.
 */
/**
 * Cached for half an hour, deliberately longer than anything else here.
 *
 * This compares a seven-day window against ninety days, both ending yesterday.
 * Neither can change before tomorrow, so a sixty-second TTL would buy no
 * freshness at all and would cost two paginated insight sweeps on every load of
 * the Campaigns screen - on accounts that have already spent a day blocked by
 * their own rate limit. The window it answers about is a day wide; the cache
 * should be too.
 */
const WATCH_TTL = 30 * 60 * 1000;

export async function getCplWatch(adAccountId: string, now = new Date()): Promise<CplWatchResult> {
  const until = addDays(todayInAccountTz(now), -1);
  return cached(`cplwatch:${adAccountId}:${until}`, WATCH_TTL, () => build(adAccountId, until));
}

async function build(adAccountId: string, until: string): Promise<CplWatchResult> {
  const recentSince = addDays(until, -(RECENT_DAYS - 1));
  const baselineUntil = addDays(recentSince, -1);
  const baselineSince = addDays(baselineUntil, -(BASELINE_DAYS - 1));

  const [recentOut, baselineOut] = await Promise.all([
    getLiveCampaignMetrics(adAccountId, { since: recentSince, until }),
    getLiveCampaignMetrics(adAccountId, { since: baselineSince, until: baselineUntil }),
  ]);

  const baselineById = new Map(baselineOut.campaigns.map((c) => [c.campaignId, c]));
  const notes: string[] = [];
  let thinHistory = 0;

  const rows: CplWatchRow[] = recentOut.campaigns.map((r) => {
    const b = baselineById.get(r.campaignId);
    const recent = windowOf(r, recentSince, until, RECENT_DAYS);
    const baseline = windowOf(b, baselineSince, baselineUntil, BASELINE_DAYS);

    const base: Omit<CplWatchRow, "verdict" | "summary" | "cplChange" | "spendChange"> = {
      campaignId: r.campaignId,
      name: r.name,
      status: r.status,
      cities: r.cities,
      resultType: r.resultType,
      resultAction: r.resultAction,
      baseline,
      recent,
    };

    // --- can anything honest be said? ---------------------------------------
    if (baseline.results < MIN_BASELINE_RESULTS || baseline.cpl <= 0) {
      thinHistory += 1;
      return {
        ...base,
        cplChange: null,
        spendChange: null,
        verdict: "TOO_LITTLE_HISTORY",
        summary:
          `Only ${baseline.results} result${baseline.results === 1 ? "" : "s"} in the previous ` +
          `${BASELINE_DAYS} days, so there is no baseline cost worth comparing against.`,
      };
    }
    if (recent.spend <= 0) {
      return {
        ...base,
        cplChange: null,
        spendChange: null,
        verdict: "STEADY",
        summary: "No delivery in the last week, so there is no recent cost to compare.",
      };
    }

    const spendChange = baseline.dailySpend > 0 ? recent.dailySpend / baseline.dailySpend - 1 : null;

    // Spending with nothing to show for it. Treated as a rise rather than
    // skipped: a cost per result of zero is the ABSENCE of results, and this is
    // the shape a broken pixel or a dead form takes.
    if (recent.results === 0) {
      const explained = spendChange !== null && spendChange < -SPEND_TOLERANCE;
      return {
        ...base,
        cplChange: null,
        spendChange,
        verdict: explained ? "EXPECTED_AFTER_CUT" : "ATTENTION",
        summary: explained
          ? `No results in the last week, on ${pct(spendChange!)} less spend per day. Worth a look, but the cut ` +
            `explains part of it.`
          : `Spending with no results at all in the last week, at ${pct(Math.abs(spendChange ?? 0))} ` +
            `${(spendChange ?? 0) >= 0 ? "more" : "less"} spend per day. Check the form or the pixel before the budget.`,
      };
    }

    const cplChange = recent.cpl / baseline.cpl - 1;

    if (cplChange < CPL_RISE) {
      return {
        ...base,
        cplChange,
        spendChange,
        verdict: "STEADY",
        summary:
          cplChange >= 0
            ? `Cost per result is ${pct(cplChange)} above its ${BASELINE_DAYS}-day average — within normal movement.`
            : `Cost per result is ${pct(cplChange)} below its ${BASELINE_DAYS}-day average.`,
      };
    }

    // --- the rise is real. Was it bought? -----------------------------------
    if (spendChange !== null && spendChange < -SPEND_TOLERANCE) {
      return {
        ...base,
        cplChange,
        spendChange,
        verdict: "EXPECTED_AFTER_CUT",
        summary:
          `Cost per result is up ${pct(cplChange)}, but daily spend is down ${pct(spendChange)} — a smaller budget ` +
          `usually costs more per result, so this is the cut showing up rather than a new problem.`,
      };
    }
    if (spendChange !== null && spendChange > SPEND_TOLERANCE) {
      return {
        ...base,
        cplChange,
        spendChange,
        verdict: "SCALING",
        summary:
          `Cost per result is up ${pct(cplChange)} while daily spend is up ${pct(spendChange)} — the usual price of ` +
          `buying more volume. Worth deciding whether the extra results are worth it.`,
      };
    }

    return {
      ...base,
      cplChange,
      spendChange,
      verdict: "ATTENTION",
      summary:
        `Cost per result is up ${pct(cplChange)} on essentially the same daily spend` +
        `${spendChange === null ? "" : ` (${spendChange >= 0 ? "+" : "−"}${pct(spendChange)})`}. ` +
        `Nothing about the budget explains this.`,
    };
  });

  const attention = rows
    .filter((r) => r.verdict === "ATTENTION")
    // Worst first, by how much more each result now costs. A campaign spending
    // ₹2L with a 30% rise matters more than one spending ₹4K with a 90% rise,
    // so the rise is weighted by what it is costing.
    .sort((a, b) => (b.cplChange ?? 0) * b.recent.spend - (a.cplChange ?? 0) * a.recent.spend);

  if (thinHistory > 0) {
    notes.push(
      `${thinHistory} campaign${thinHistory === 1 ? "" : "s"} had fewer than ${MIN_BASELINE_RESULTS} results in the ` +
        `previous ${BASELINE_DAYS} days and were left out — a cost per result built on a handful of results is noise, ` +
        `and comparing two such numbers is worse.`
    );
  }
  notes.push(...recentOut.notes, ...baselineOut.notes);

  return {
    baselineWindow: { since: baselineSince, until: baselineUntil },
    recentWindow: { since: recentSince, until },
    attention,
    rows,
    notes,
  };
}
