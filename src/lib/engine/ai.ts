import type { CityMetrics, GeneratedRecommendation } from "./types";

/**
 * AI Optimisation Engine (spec section 14).
 *
 * This is a deterministic, explainable "AI" — it reasons over the same
 * structured performance fields a human analyst would (spend, CPL,
 * leads, CTR, CPC, inventory, inventory age, trend) and produces a
 * recommendation that always answers the three-question UX principle
 * from section 25: what happened, why, and what to do.
 *
 * A real deployment would run an LLM over this same structured data to
 * generate more varied prose — the reasoning inputs and thresholds here
 * are exactly what that LLM call would be grounded on.
 */
export function generateAIRecommendations(cities: CityMetrics[]): GeneratedRecommendation[] {
  const recs: GeneratedRecommendation[] = [];

  for (const c of cities) {
    // A city with no delivery has nothing to reason about. Every branch below
    // reads a week-over-week change or an inventory count against a running
    // campaign; applied to a city launched this morning they produce confident
    // nonsense — "CPL improved", "inventory has dropped", "reduce budget".
    if (c.spend <= 0) continue;

    const reasons: string[] = [];

    if (c.wowCplChange > 8) {
      if (c.wowInventoryChange < -5) reasons.push(`Inventory decreased ${Math.abs(Math.round(c.wowInventoryChange))}% this week`);
      if (c.wowCpcChange > 5) reasons.push(`CPC increased ${Math.round(c.wowCpcChange)}%`);
      if (c.wowCtrChange < -3) reasons.push(`CTR decreased ${Math.abs(Math.round(c.wowCtrChange))}%`);
      if (c.inventoryOld60d / Math.max(c.inventoryActive, 1) > 0.25) {
        reasons.push(`${Math.round((c.inventoryOld60d / Math.max(c.inventoryActive, 1)) * 100)}% of active inventory is older than 60 days`);
      }
      if (reasons.length === 0) reasons.push("Auction competition increased broadly in this market this week");

      recs.push({
        scope: "CITY",
        cityId: c.cityId,
        title: `${c.cityName} CPL increased ${Math.round(c.wowCplChange)}% WoW`,
        reasons,
        recommendedAction: `Reduce ${c.cityName} budget by 15% and prioritise newer inventory in the catalogue set.`,
        impactEstimate: `Est. CPL relief: ₹${Math.round(c.cpl * 0.1)}–₹${Math.round(c.cpl * 0.15)} within 5-7 days`,
        suggestedDailyBudget: Math.round((c.dailyBudget * 0.85) / 500) * 500,
      });
    } else if (c.wowCplChange < -8 && c.leads > 0) {
      recs.push({
        scope: "CITY",
        cityId: c.cityId,
        title: `${c.cityName} CPL improved ${Math.abs(Math.round(c.wowCplChange))}% WoW`,
        reasons: [
          `CPL is now ₹${Math.round(c.cpl)} against an ₹${c.targetCpl} target`,
          `${c.inventoryActive.toLocaleString("en-IN")} active units available to sustain higher spend`,
          c.wowCtrChange > 0 ? `CTR is up ${Math.round(c.wowCtrChange)}%, indicating stronger creative relevance` : `Lead volume is trending up`,
        ],
        recommendedAction: `Increase ${c.cityName} daily budget by 15-20% to capture more volume while efficiency is high.`,
        impactEstimate: `Est. incremental leads: +${Math.round(c.leads * 0.15)}/week`,
        suggestedDailyBudget: Math.round((c.dailyBudget * 1.18) / 500) * 500,
      });
    }

    if (c.inventoryActive < 300) {
      recs.push({
        scope: "CITY",
        cityId: c.cityId,
        title: `${c.cityName} inventory has dropped to ${c.inventoryActive} units`,
        reasons: [
          `Active inventory is ${Math.round((c.inventoryActive / Math.max(c.inventoryTotal, 1)) * 100)}% of total listed stock`,
          `Continuing to spend at current levels risks showing sold-out or repetitive creative`,
        ],
        recommendedAction: `Reduce campaign budget for ${c.cityName} until inventory recovers above 300 units, or merge into a cluster campaign.`,
        suggestedDailyBudget: Math.round((c.dailyBudget * 0.8) / 500) * 500,
      });
    } else if (c.inventoryActive > 1200 && c.cpl < c.targetCpl * 0.85) {
      recs.push({
        scope: "CITY",
        cityId: c.cityId,
        title: `${c.cityName} has high inventory availability and CPL ${Math.round(((c.targetCpl - c.cpl) / c.targetCpl) * 100)}% below target`,
        reasons: [
          `${c.inventoryActive.toLocaleString("en-IN")} active units — one of the deepest catalogues in the network`,
          `CPL efficiency has headroom before hitting target`,
        ],
        recommendedAction: `Increase budget for ${c.cityName} — the inventory depth supports it.`,
        suggestedDailyBudget: Math.round((c.dailyBudget * 1.15) / 500) * 500,
      });
    }
  }

  return recs;
}

export interface WeeklySummaryInput {
  totalSpend: number;
  prevTotalSpend: number;
  totalLeads: number;
  prevTotalLeads: number;
  cpl: number;
  prevCpl: number;
  bestCity: CityMetrics;
  worstCity: CityMetrics;
}

/** AI Weekly Summary (spec section 22). */
export function generateWeeklySummary(input: WeeklySummaryInput): string {
  const leadsChangePct = pctChange(input.totalLeads, input.prevTotalLeads);
  const spendChangePct = pctChange(input.totalSpend, input.prevTotalSpend);
  const spendPhrase =
    Math.abs(spendChangePct) < 3 ? "remained flat" : spendChangePct > 0 ? `rose ${Math.round(spendChangePct)}%` : `fell ${Math.round(Math.abs(spendChangePct))}%`;

  const lines = [
    `Leads ${leadsChangePct >= 0 ? "increased" : "decreased"} ${Math.round(Math.abs(leadsChangePct))}% WoW while spend ${spendPhrase}.`,
    `Overall CPL ${input.cpl <= input.prevCpl ? "reduced" : "increased"} from ₹${Math.round(input.prevCpl)} to ₹${Math.round(input.cpl)}.`,
    `${input.bestCity.cityName} was the strongest-performing city with a CPL of ₹${Math.round(input.bestCity.cpl)}.`,
    `${input.worstCity.cityName} CPL ${input.worstCity.wowCplChange >= 0 ? "increased" : "decreased"} ${Math.round(Math.abs(input.worstCity.wowCplChange))}% ${
      input.worstCity.wowCplChange >= 0 ? "due to declining inventory and higher CPC" : "on stronger creative performance"
    }.`,
    `Recommended action: ${
      input.worstCity.wowCplChange >= 0
        ? `reduce ${input.worstCity.cityName} budget by 15% and shift budget toward ${input.bestCity.cityName}.`
        : `sustain current allocation across top-performing cities.`
    }`,
  ];
  return lines.join(" ");
}

function pctChange(now: number, prev: number) {
  if (prev === 0) return 0;
  return ((now - prev) / prev) * 100;
}
