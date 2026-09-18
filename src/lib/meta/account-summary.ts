/**
 * The account's numbers for a date range, read from Meta.
 *
 * This replaces `/api/dashboard/summary`, which read the local
 * `performance_daily` table. That table stopped being written on 2026-09-01, so
 * the front page of a tool badged "Live — real ad account" was showing a
 * fortnight-old picture. It also carried qualified leads, CPQL, conversion rate
 * and sales, which are CRM stages Meta has never known anything about — on
 * seeded data they looked like measurements.
 *
 * Three rules shape what is here:
 *
 *   1. EVERY NUMBER COMES FROM THE RANGE ON SCREEN. The old page hardcoded
 *      "last 7 days" in one tile, "last 30 days" in the chart, and a 30-day
 *      window in the API behind a label that said 7. A figure whose window you
 *      cannot see is a figure you cannot check against Ads Manager.
 *
 *   2. THE COMPARISON IS THE PRECEDING EQUAL WINDOW. Not "last week" in the
 *      calendar sense — the N days immediately before `since`, where N is the
 *      length of the selected range. Comparing 11 days of this month against a
 *      fixed 7-day block is how a delta ends up meaning nothing.
 *
 *   3. REACH IS NOT SUMMABLE. Unique people over 30 days is not the sum of
 *      unique people per day, so reach and frequency are asked for once over
 *      the whole range rather than added up from the daily series. Summing them
 *      is the single most common way a dashboard overstates its audience.
 */

import { actPath, graphGet } from "./graph";
import { leadActionType, leadEventName } from "./city-leads";
import { TTL, cached } from "./cache";
import { addDays, dayCount } from "../date-range";

export interface Totals {
  spend: number;
  leads: number;
  cpl: number;
  impressions: number;
  clicks: number;
  reach: number;
  ctr: number;
  cpc: number;
  cpm: number;
  frequency: number;
}

export interface SeriesPoint {
  date: string;
  spend: number;
  leads: number;
}

export interface AccountSummary {
  range: { since: string; until: string };
  /** The equal-length window immediately before `range`. */
  previous: { since: string; until: string };
  days: number;
  totals: Totals;
  previousTotals: Totals;
  series: SeriesPoint[];
  /** The pixel event this app counts as a lead, named so it can be checked. */
  leadAction: string;
  notes: string[];
}

interface InsightRow {
  date_start?: string;
  date_stop?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  frequency?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: { action_type: string; value: string }[];
  conversions?: { action_type: string; value: string }[];
}

const n = (v?: string) => (v ? Number(v) || 0 : 0);

/**
 * Custom pixel events arrive in `conversions`, standard ones in `actions`.
 * Reading only `actions` is what made every city report zero leads for a week.
 */
function readLeads(row: InsightRow | undefined, action: string): number {
  if (!row) return 0;
  const all = [...(row.conversions ?? []), ...(row.actions ?? [])];
  return Number(all.find((x) => x.action_type === action)?.value ?? 0) || 0;
}

const FIELDS = "spend,impressions,clicks,reach,frequency,ctr,cpc,cpm,actions,conversions";

const EMPTY: Totals = {
  spend: 0,
  leads: 0,
  cpl: 0,
  impressions: 0,
  clicks: 0,
  reach: 0,
  ctr: 0,
  cpc: 0,
  cpm: 0,
  frequency: 0,
};

function toTotals(row: InsightRow | undefined, action: string): Totals {
  if (!row) return { ...EMPTY };
  const spend = n(row.spend);
  const leads = readLeads(row, action);
  const impressions = n(row.impressions);
  const reach = n(row.reach);
  return {
    spend,
    leads,
    cpl: leads > 0 ? spend / leads : 0,
    impressions,
    clicks: n(row.clicks),
    reach,
    // Read back from Meta rather than recomputed, so the last digit matches
    // Ads Manager.
    ctr: n(row.ctr),
    cpc: n(row.cpc),
    cpm: n(row.cpm),
    frequency: n(row.frequency) || (reach > 0 ? impressions / reach : 0),
  };
}

/** One account-level insights read. Account rows are a single row, not a page. */
async function accountInsights(
  adAccountId: string,
  range: { since: string; until: string },
  daily: boolean
): Promise<InsightRow[]> {
  const body = await graphGet<{ data: InsightRow[] }>(actPath(adAccountId, "insights"), {
    level: "account",
    fields: FIELDS,
    time_range: JSON.stringify({ since: range.since, until: range.until }),
    ...(daily ? { time_increment: "1" } : {}),
    limit: "500",
  });
  return body.data ?? [];
}

/** The N days immediately before the range, where N is the range's own length. */
export function precedingWindow(range: { since: string; until: string }): { since: string; until: string } {
  const days = dayCount({ ...range, preset: "custom" });
  const until = addDays(range.since, -1);
  return { since: addDays(until, -(days - 1)), until };
}

export async function getAccountSummary(
  adAccountId: string,
  range: { since: string; until: string }
): Promise<AccountSummary> {
  const action = leadActionType();
  const previous = precedingWindow(range);
  const notes: string[] = [];

  const key = (label: string, r: { since: string; until: string }) =>
    `account:${label}:${adAccountId}:${r.since}:${r.until}`;

  const [current, prior, daily] = await Promise.all([
    cached(key("totals", range), TTL.insights, () => accountInsights(adAccountId, range, false)),
    cached(key("prev", previous), TTL.insights, () => accountInsights(adAccountId, previous, false)),
    cached(key("daily", range), TTL.insights, () => accountInsights(adAccountId, range, true)),
  ]);

  const totals = toTotals(current[0], action);
  const previousTotals = toTotals(prior[0], action);

  const series: SeriesPoint[] = daily
    .filter((r) => r.date_start)
    .map((r) => ({ date: r.date_start!, spend: n(r.spend), leads: readLeads(r, action) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (totals.spend === 0 && totals.impressions === 0) {
    notes.push(
      "Meta reports no delivery at all in this range. That is a real answer, not a loading state — nothing was served."
    );
  } else if (totals.leads === 0 && totals.spend > 0) {
    // Worth saying out loud: it is almost always the event name, not the
    // campaigns. Naming the bare event and where to change it turns a figure
    // that looks like a bad month into one somebody can actually fix.
    notes.push(
      `Spend but no leads. This account counts only the pixel event "${leadEventName()}" as a lead. If this ` +
        `account fires a different event, set it against the account in Settings -> Ad accounts - until then every ` +
        `lead and CPL figure here reads zero while spend, clicks and impressions look normal.`
    );
  }

  return {
    range: { since: range.since, until: range.until },
    previous,
    days: dayCount({ ...range, preset: "custom" }),
    totals,
    previousTotals,
    series,
    leadAction: action,
    notes,
  };
}

/** Percentage change, with the two cases that break the naive formula. */
export function pctChange(now: number, before: number): number | null {
  // No baseline means no percentage. "+100%" against zero is a made-up number,
  // and an arrow pointing up is worse than a dash.
  if (before === 0) return null;
  return ((now - before) / before) * 100;
}
