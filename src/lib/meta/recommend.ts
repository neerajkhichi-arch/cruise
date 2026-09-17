/**
 * Budget recommendations, built to be defensible.
 *
 * The panel this replaces recommended raising Noida from ₹1.6K to ₹2.5K on the
 * grounds that "CPL ₹0 is below the ₹110 target with 0 active units — room to
 * scale". Noida had no delivery at all. A cost of zero is the ABSENCE of data,
 * not a good result, and a recommendation engine that cannot tell those apart
 * will confidently spend money on nothing.
 *
 * So the rules here are mostly about refusing to speak:
 *
 *   1. ONLY LIVE CAMPAIGNS. A paused campaign has nothing to recommend. It is
 *      reported as excluded rather than silently dropped, so "why is Mohali not
 *      here" has an answer.
 *   2. NO DELIVERY, NO OPINION. Zero spend in the recent window means there is
 *      nothing to judge.
 *   3. ENOUGH EVIDENCE, OR SAY SO. Under ten leads in the baseline, a CPL is
 *      noise. Those become LOW confidence and never drive a budget increase.
 *   4. TWO WINDOWS, NOT ONE. A baseline for the level and the last three days
 *      for the direction. An average over a fortnight hides a campaign that
 *      fell apart on Friday.
 *   5. COMPARE INSIDE A COHORT. Result type and attribution travel with every
 *      number; cost is only comparable within one.
 *   6. THE MONTHLY BUDGET IS A CEILING, NOT A SUGGESTION. Nothing is ever
 *      recommended upward past what the month can afford, and a city pacing
 *      over gets the daily number that lands it exactly on budget.
 */

import { getLiveCampaignMetrics } from "./campaign-insights";
import { getCityLeadsThisMonth, currentMonthRange } from "./city-leads";
import { fetchLeadTargets, type LeadTarget } from "../sheets/lead-targets";
import { addDays, dayCount, endOfMonth, todayInAccountTz } from "../date-range";

export type Action = "DECREASE_BUDGET" | "INCREASE_BUDGET" | "PAUSE" | "INVESTIGATE";

export interface WindowStats {
  since: string;
  until: string;
  spend: number;
  leads: number;
  cpl: number;
}

export interface Recommendation {
  campaignId: string;
  campaignName: string;
  cityName: string;
  cohort: string;
  action: Action;
  currentDailyBudget: number;
  suggestedDailyBudget: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  baseline: WindowStats;
  recent: WindowStats;
  /** Where the month stands for this city, when the sheet governs it. */
  month: {
    since: string;
    until: string;
    spend: number;
    budget: number | null;
    usedPct: number | null;
    /** Spend the month will reach at the current rate. */
    projected: number | null;
    daysLeft: number;
  };
  /** Plain sentences, each one a fact that led to the recommendation. */
  reasons: string[];
}

export interface Excluded {
  campaignName: string;
  cityName: string;
  reason: string;
}

export interface RecommendationResult {
  baselineWindow: { since: string; until: string };
  recentWindow: { since: string; until: string };
  monthWindow: { since: string; until: string };
  recommendations: Recommendation[];
  /** Campaigns deliberately not advised on, and why. */
  excluded: Excluded[];
  generatedAt: string;
}

const RECENT_DAYS = 3;
const BASELINE_DAYS = 14;
/** Below this, a cost per lead is noise rather than a measurement. */
const MIN_LEADS_FOR_CPL = 10;
/** A move smaller than this is not worth an operator's attention. */
const MIN_CHANGE_PCT = 0.1;

const round = (n: number) => Math.round(n);

function stats(since: string, until: string, spend: number, leads: number): WindowStats {
  return { since, until, spend: round(spend), leads, cpl: leads > 0 ? spend / leads : 0 };
}

export async function buildRecommendations(adAccountId: string, now = new Date()): Promise<RecommendationResult> {
  const today = todayInAccountTz(now);
  // Both windows end YESTERDAY. Today is partial, and a half-day of delivery
  // looks like a collapse in cost per lead if you let it into an average.
  const until = addDays(today, -1);
  const recentSince = addDays(until, -(RECENT_DAYS - 1));
  const baselineSince = addDays(until, -(BASELINE_DAYS - 1));

  const month = currentMonthRange(now);

  const [baselineRows, recentRows, cityMonth, sheet] = await Promise.all([
    getLiveCampaignMetrics(adAccountId, { since: baselineSince, until }),
    getLiveCampaignMetrics(adAccountId, { since: recentSince, until }),
    getCityLeadsThisMonth(adAccountId, month),
    fetchLeadTargets().catch(() => null),
  ]);

  const recentById = new Map(recentRows.campaigns.map((c) => [c.campaignId, c]));
  const monthByCity = new Map(cityMonth.cities.map((c) => [c.cityName.toLowerCase(), c]));
  const targetByCity = new Map<string, LeadTarget>(
    (sheet?.targets ?? []).map((t) => [t.cityName.toLowerCase(), t])
  );

  const daysLeftInMonth = Math.max(0, dayCount({ since: today, until: endOfMonth(today), preset: "custom" }) - 1);
  const elapsedDays = Math.max(1, dayCount({ since: month.since, until: month.until, preset: "custom" }));

  const recommendations: Recommendation[] = [];
  const excluded: Excluded[] = [];

  for (const base of baselineRows.campaigns) {
    const cityName = base.cities[0] ?? "—";
    const name = base.name;

    // --- 1. only live campaigns ------------------------------------------
    if (base.status !== "ACTIVE") {
      excluded.push({ campaignName: name, cityName, reason: `Campaign is ${base.status.toLowerCase()}.` });
      continue;
    }

    const rec = recentById.get(base.campaignId);
    const recentSpend = rec?.spend ?? 0;
    const recentLeads = rec?.leads ?? 0;

    // --- 2. no delivery, no opinion ---------------------------------------
    if (recentSpend <= 0) {
      excluded.push({
        campaignName: name,
        cityName,
        reason: `Active but spent nothing in the last ${RECENT_DAYS} days, so there is nothing to judge.`,
      });
      continue;
    }

    const baseline = stats(baselineSince, until, base.spend, base.leads);
    const recent = stats(recentSince, until, recentSpend, recentLeads);

    // --- the month, for this city ------------------------------------------
    const cm = monthByCity.get(cityName.toLowerCase());
    const target = targetByCity.get(cityName.toLowerCase());
    const monthSpend = round(cm?.spend ?? 0);
    const budget = target?.budget ?? null;
    const usedPct = budget ? monthSpend / budget : null;
    const projected = budget ? round((monthSpend / elapsedDays) * (elapsedDays + daysLeftInMonth)) : null;
    const monthBlock = {
      since: month.since,
      until: month.until,
      spend: monthSpend,
      budget,
      usedPct,
      projected,
      daysLeft: daysLeftInMonth,
    };

    const current = round(base.dailyBudget);
    const reasons: string[] = [];

    // --- 3. is there enough evidence to talk about cost? ------------------
    const enoughBaseline = baseline.leads >= MIN_LEADS_FOR_CPL;
    const enoughRecent = recent.leads >= Math.ceil(MIN_LEADS_FOR_CPL / 3);

    // --- budget first: a ceiling beats any efficiency argument -------------
    if (budget !== null && monthSpend >= budget) {
      recommendations.push({
        campaignId: base.campaignId,
        campaignName: name,
        cityName,
        cohort: base.cohort,
        action: "PAUSE",
        currentDailyBudget: current,
        suggestedDailyBudget: 0,
        confidence: "HIGH",
        baseline,
        recent,
        month: monthBlock,
        reasons: [
          `₹${monthSpend.toLocaleString("en-IN")} spent against a ₹${budget.toLocaleString("en-IN")} monthly budget — the ceiling is already passed.`,
          `Spend is a settled figure, not an estimate, so this does not depend on how leads are attributed.`,
        ],
      });
      continue;
    }

    if (budget !== null && projected !== null && projected > budget && daysLeftInMonth > 0) {
      // The daily number that lands exactly on budget over the days remaining.
      const remaining = Math.max(0, budget - monthSpend);
      const paced = round(remaining / daysLeftInMonth);
      reasons.push(
        `At the current rate this city reaches ₹${projected.toLocaleString("en-IN")} by month end against a ₹${budget.toLocaleString("en-IN")} budget.`,
        `₹${remaining.toLocaleString("en-IN")} left over ${daysLeftInMonth} day${daysLeftInMonth === 1 ? "" : "s"} is ₹${paced.toLocaleString("en-IN")} a day.`
      );
      if (paced < current * (1 - MIN_CHANGE_PCT)) {
        recommendations.push({
          campaignId: base.campaignId,
          campaignName: name,
          cityName,
          cohort: base.cohort,
          action: "DECREASE_BUDGET",
          currentDailyBudget: current,
          suggestedDailyBudget: paced,
          confidence: "HIGH",
          baseline,
          recent,
          month: monthBlock,
          reasons,
        });
        continue;
      }
    }

    // --- efficiency, and only where the evidence supports it --------------
    if (!enoughBaseline) {
      recommendations.push({
        campaignId: base.campaignId,
        campaignName: name,
        cityName,
        cohort: base.cohort,
        action: "INVESTIGATE",
        currentDailyBudget: current,
        suggestedDailyBudget: null,
        confidence: "LOW",
        baseline,
        recent,
        month: monthBlock,
        reasons: [
          `Only ${baseline.leads} lead${baseline.leads === 1 ? "" : "s"} in ${BASELINE_DAYS} days — too few to read a cost per lead from.`,
          `₹${baseline.spend.toLocaleString("en-IN")} spent for that, so it is worth a look rather than a budget change.`,
        ],
      });
      continue;
    }

    const trend = recent.cpl > 0 && baseline.cpl > 0 ? recent.cpl / baseline.cpl - 1 : 0;
    const trendPct = Math.round(Math.abs(trend) * 100);

    if (trend > 0.2 && enoughRecent) {
      const suggested = round(current * 0.85);
      recommendations.push({
        campaignId: base.campaignId,
        campaignName: name,
        cityName,
        cohort: base.cohort,
        action: "DECREASE_BUDGET",
        currentDailyBudget: current,
        suggestedDailyBudget: suggested,
        confidence: recent.leads >= MIN_LEADS_FOR_CPL ? "HIGH" : "MEDIUM",
        baseline,
        recent,
        month: monthBlock,
        reasons: [
          `Cost per lead is ₹${round(recent.cpl)} over the last ${RECENT_DAYS} days against ₹${round(baseline.cpl)} over ${BASELINE_DAYS} — ${trendPct}% worse.`,
          `Both figures are ${base.cohort.replace("::", " on ")}, so they are comparable.`,
          `${recent.leads} lead${recent.leads === 1 ? "" : "s"} in the recent window.`,
        ],
      });
      continue;
    }

    if (trend < -0.2 && enoughRecent) {
      // Improving — but only scale into room the month actually has.
      let suggested = round(current * 1.15);
      const capped: string[] = [];
      if (budget !== null && daysLeftInMonth > 0) {
        const remaining = Math.max(0, budget - monthSpend);
        const affordable = round(remaining / daysLeftInMonth);
        if (affordable < suggested) {
          suggested = affordable;
          capped.push(
            `Capped by the monthly budget: ₹${remaining.toLocaleString("en-IN")} left over ${daysLeftInMonth} day${daysLeftInMonth === 1 ? "" : "s"}.`
          );
        }
      }
      if (suggested > current * (1 + MIN_CHANGE_PCT)) {
        recommendations.push({
          campaignId: base.campaignId,
          campaignName: name,
          cityName,
          cohort: base.cohort,
          action: "INCREASE_BUDGET",
          currentDailyBudget: current,
          suggestedDailyBudget: suggested,
          confidence: recent.leads >= MIN_LEADS_FOR_CPL ? "HIGH" : "MEDIUM",
          baseline,
          recent,
          month: monthBlock,
          reasons: [
            `Cost per lead is ₹${round(recent.cpl)} over the last ${RECENT_DAYS} days against ₹${round(baseline.cpl)} over ${BASELINE_DAYS} — ${trendPct}% better.`,
            `Both figures are ${base.cohort.replace("::", " on ")}, so they are comparable.`,
            ...capped,
          ],
        });
        continue;
      }
      if (capped.length > 0) {
        excluded.push({
          campaignName: name,
          cityName,
          reason: `Improving, but the monthly budget leaves no room to scale into.`,
        });
        continue;
      }
    }

    // Steady inside its budget. Nothing to say, and saying nothing is correct.
    excluded.push({
      campaignName: name,
      cityName,
      reason: `Steady — cost per lead within ${Math.round(MIN_CHANGE_PCT * 100)}–20% of its ${BASELINE_DAYS}-day level and inside its budget.`,
    });
  }

  // Money first: a city over its ceiling outranks one that is merely expensive.
  const rank: Record<Action, number> = { PAUSE: 0, DECREASE_BUDGET: 1, INCREASE_BUDGET: 2, INVESTIGATE: 3 };
  recommendations.sort((a, b) => rank[a.action] - rank[b.action] || b.recent.spend - a.recent.spend);

  return {
    baselineWindow: { since: baselineSince, until },
    recentWindow: { since: recentSince, until },
    monthWindow: month,
    recommendations,
    excluded,
    generatedAt: new Date().toISOString(),
  };
}
