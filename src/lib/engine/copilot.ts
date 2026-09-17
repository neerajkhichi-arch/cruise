import type { CityMetrics, VehicleMetrics } from "./types";
import { recommendBudgetAllocation } from "./budget";

export interface CopilotContext {
  cities: CityMetrics[];
  vehicles: VehicleMetrics[];
  totalDailyBudget: number;
  totalSpend: number;
  totalLeads: number;
  overallCpl: number;
  leadsYesterday: number;
  leadsDayBefore: number;
}

export interface CopilotAction {
  label: string;
  type: "APPLY_BUDGET_CHANGE";
  cityId: string;
  cityName: string;
  currentBudget: number;
  newBudget: number;
}

export interface CopilotResponse {
  answer: string;
  action?: CopilotAction;
}

function findCity(cities: CityMetrics[], q: string): CityMetrics | undefined {
  const lower = q.toLowerCase();
  return cities.find((c) => lower.includes(c.cityName.toLowerCase()));
}

function extractNumber(q: string): number | undefined {
  const cleaned = q.replace(/,/g, "");
  const lakhMatch = cleaned.match(/([\d.]+)\s*(lakh|lac|l\b)/i);
  if (lakhMatch) return parseFloat(lakhMatch[1]) * 100000;
  const croreMatch = cleaned.match(/([\d.]+)\s*(crore|cr\b)/i);
  if (croreMatch) return parseFloat(croreMatch[1]) * 10000000;
  const rupeeMatch = cleaned.match(/₹?\s*([\d.]+)/);
  if (rupeeMatch) return parseFloat(rupeeMatch[1]);
  return undefined;
}

export function answerCopilotQuestion(question: string, ctx: CopilotContext): CopilotResponse {
  const q = question.toLowerCase().trim();

  // "Why is <city> CPL increasing/high?"
  if (/why/.test(q) && /cpl/.test(q)) {
    const city = findCity(ctx.cities, q);
    if (city) {
      const reasons: string[] = [];
      if (city.wowInventoryChange < -5) reasons.push(`inventory dropped ${Math.abs(Math.round(city.wowInventoryChange))}% this week`);
      if (city.wowCpcChange > 5) reasons.push(`CPC rose ${Math.round(city.wowCpcChange)}%`);
      if (city.wowCtrChange < -3) reasons.push(`CTR fell ${Math.abs(Math.round(city.wowCtrChange))}%`);
      if (city.inventoryOld60d / Math.max(city.inventoryActive, 1) > 0.25) {
        reasons.push(`${Math.round((city.inventoryOld60d / Math.max(city.inventoryActive, 1)) * 100)}% of inventory is 60+ days old`);
      }
      const reasonText = reasons.length ? reasons.join(", ") : "broader auction competition this week";
      const suggestedBudget = Math.round(city.dailyBudget * 0.85 / 500) * 500;
      return {
        answer: `${city.cityName} CPL is ₹${Math.round(city.cpl)} against a ₹${city.targetCpl} target, ${city.wowCplChange >= 0 ? "up" : "down"} ${Math.round(Math.abs(city.wowCplChange))}% week-over-week. Main drivers: ${reasonText}. Recommendation: reduce the daily budget from ₹${Math.round(city.dailyBudget).toLocaleString("en-IN")} to ₹${suggestedBudget.toLocaleString("en-IN")} and prioritise fresher inventory.`,
        action:
          city.wowCplChange > 5
            ? { label: `Reduce ${city.cityName} budget to ₹${suggestedBudget.toLocaleString("en-IN")}`, type: "APPLY_BUDGET_CHANGE", cityId: city.cityId, cityName: city.cityName, currentBudget: city.dailyBudget, newBudget: suggestedBudget }
            : undefined,
      };
    }
  }

  // "Which city is performing best/worst?"
  if (/(best|top|worst|weakest)/.test(q) && /(city|cities|perform)/.test(q) && !/budget/.test(q)) {
    const worst = /worst|weakest/.test(q);
    // Cities with no delivery are excluded from the ranking: a ₹0 cost per
    // result is the absence of results, and sorting on it puts a city launched
    // this morning at the top.
    const rankable = ctx.cities.filter((c) => c.spend > 0 && c.leads > 0);
    if (rankable.length === 0) {
      return {
        answer:
          "No city has enough delivery to rank yet. A city with no results has no cost per result, so there is nothing to compare.",
      };
    }
    const ranked = [...rankable].sort((a, b) => (worst ? b.cpl - a.cpl : a.cpl - b.cpl));
    const pick = ranked[0];
    if (pick) {
      return {
        answer: worst
          ? `${pick.cityName} is the weakest performer right now — CPL of ₹${Math.round(pick.cpl)} against a ₹${pick.targetCpl} target (${pick.wowCplChange >= 0 ? "+" : ""}${Math.round(pick.wowCplChange)}% WoW), with ${pick.inventoryActive.toLocaleString("en-IN")} active units.`
          : `${pick.cityName} is the strongest-performing city — CPL of ₹${Math.round(pick.cpl)} against a ₹${pick.targetCpl} target, ${pick.leads.toLocaleString("en-IN")} leads generated and CTR of ${pick.ctr.toFixed(1)}%.`,
      };
    }
  }

  // "Where should I move/shift budget?" / "Which city should get more budget?"
  if ((/which city/.test(q) && /budget/.test(q)) || (/(move|shift|reallocate)/.test(q) && /budget/.test(q))) {
    const allocation = recommendBudgetAllocation(ctx.cities, ctx.totalDailyBudget);
    const top = allocation.sort((a, b) => b.changePct - a.changePct)[0];
    if (top) {
      return {
        answer: `${top.cityName} is the best candidate for more budget. ${top.rationale} Recommended daily budget: ₹${top.recommendedBudget.toLocaleString("en-IN")} (from ₹${top.currentBudget.toLocaleString("en-IN")}, ${top.changePct >= 0 ? "+" : ""}${top.changePct}%).`,
        action: { label: `Increase ${top.cityName} budget to ₹${top.recommendedBudget.toLocaleString("en-IN")}`, type: "APPLY_BUDGET_CHANGE", cityId: top.cityId, cityName: top.cityName, currentBudget: top.currentBudget, newBudget: top.recommendedBudget },
      };
    }
  }

  // "Increase budget for <city>."
  if (/increase budget/.test(q)) {
    const city = findCity(ctx.cities, q);
    if (city) {
      const newBudget = Math.round((city.dailyBudget * 1.25) / 500) * 500;
      return {
        answer: `${city.cityName} currently has a ₹${Math.round(city.cpl)} CPL against an ₹${city.targetCpl} target and ${city.inventoryActive.toLocaleString("en-IN")} active units of inventory. I recommend increasing the daily budget from ₹${Math.round(city.dailyBudget).toLocaleString("en-IN")} to ₹${newBudget.toLocaleString("en-IN")}.`,
        action: { label: `Increase ${city.cityName} budget to ₹${newBudget.toLocaleString("en-IN")}`, type: "APPLY_BUDGET_CHANGE", cityId: city.cityId, cityName: city.cityName, currentBudget: city.dailyBudget, newBudget },
      };
    }
  }

  // "Which vehicles are wasting spend?"
  if (/wast/.test(q) || (/vehicle/.test(q) && /spend/.test(q) && /(no lead|zero lead|poor)/.test(q))) {
    const wasted = ctx.vehicles
      .filter((v) => v.availability === "ACTIVE" && v.leads === 0 && v.spend > 300)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 5);
    if (wasted.length === 0) {
      return { answer: "No vehicles are currently spending significantly without generating leads — inventory targeting looks efficient right now." };
    }
    const list = wasted.map((v) => `${v.label} (${v.cityName}) — ₹${Math.round(v.spend)} spent, 0 leads`).join("; ");
    return { answer: `${wasted.length} vehicles are burning spend with no leads: ${list}. Recommend excluding these from the active catalogue set or refreshing pricing/images.` };
  }

  // "Why did leads drop yesterday?"
  if (/leads drop/.test(q) || (/why/.test(q) && /leads/.test(q) && /(yesterday|drop|fell)/.test(q))) {
    const change = ctx.leadsDayBefore > 0 ? ((ctx.leadsYesterday - ctx.leadsDayBefore) / ctx.leadsDayBefore) * 100 : 0;
    if (change >= -3) {
      return { answer: `Leads were broadly stable — ${ctx.leadsYesterday} yesterday vs ${ctx.leadsDayBefore} the day before (${change >= 0 ? "+" : ""}${Math.round(change)}%). No significant drop detected.` };
    }
    const worstMover = [...ctx.cities].sort((a, b) => b.wowCplChange - a.wowCplChange)[0];
    return {
      answer: `Leads fell ${Math.round(Math.abs(change))}% yesterday (${ctx.leadsDayBefore} → ${ctx.leadsYesterday}). ${worstMover ? `${worstMover.cityName} saw the sharpest CPL increase (${Math.round(worstMover.wowCplChange)}% WoW), which is the most likely contributor.` : "Check individual city trends for the specific driver."}`,
    };
  }

  // "Show cities with CPL below ₹X."
  if (/cpl (below|under|less than)/.test(q)) {
    const threshold = extractNumber(q) ?? 80;
    const matches = ctx.cities.filter((c) => c.cpl < threshold).sort((a, b) => a.cpl - b.cpl);
    if (matches.length === 0) return { answer: `No cities currently have a CPL below ₹${threshold}.` };
    return { answer: `${matches.length} cities have CPL below ₹${threshold}: ${matches.map((c) => `${c.cityName} (₹${Math.round(c.cpl)})`).join(", ")}.` };
  }

  // "Recommend how I should allocate ₹X this month."
  if (/allocat/.test(q)) {
    const amount = extractNumber(q);
    const monthlyBudget = amount ?? ctx.totalDailyBudget * 30;
    const dailyEquivalent = monthlyBudget / 30;
    const allocation = recommendBudgetAllocation(ctx.cities, dailyEquivalent).slice(0, 6);
    const list = allocation.map((a) => `${a.cityName}: ₹${Math.round((a.recommendedBudget * 30) / 100000)}L/month`).join(", ");
    return { answer: `For a ₹${Math.round(monthlyBudget / 100000)}L monthly budget, I'd allocate roughly: ${list}. This weights cities with CPL efficiency, lead volume, inventory depth, and improving trend more heavily.` };
  }

  // Fallback — account overview.
  return {
    answer: `Right now the account is spending ₹${Math.round(ctx.totalSpend / 100000)}L with ${ctx.totalLeads.toLocaleString("en-IN")} leads at a blended CPL of ₹${Math.round(ctx.overallCpl)}. Try asking about a specific city ("Why is Chandigarh CPL increasing?"), budget allocation, or underperforming vehicles.`,
  };
}
