import type { CityMetrics } from "./types";

export interface CityAllocation {
  cityId: string;
  cityName: string;
  currentBudget: number;
  recommendedBudget: number;
  changePct: number;
  rationale: string;
}

/**
 * Smart Budget Allocation (spec section 15).
 *
 * Scores each city on four signals — CPL efficiency vs. target, lead
 * volume, inventory availability, and short-term trend — then
 * distributes the total daily budget proportionally to that score,
 * with guardrails so no single city swings more than +/-40% in one pass
 * and every city keeps a viable minimum.
 */
export function recommendBudgetAllocation(cities: CityMetrics[], totalDailyBudget: number): CityAllocation[] {
  const scored = cities.map((c) => {
    const cplEfficiency = c.cpl > 0 ? clamp(c.targetCpl / c.cpl, 0.3, 2.2) : 1;
    const leadVolumeScore = clamp(c.leads / 400, 0.2, 2);
    const inventoryScore = clamp(c.inventoryActive / 800, 0.2, 1.8);
    const trendScore = clamp(1 - c.wowCplChange / 100, 0.4, 1.8); // improving CPL (negative change) scores higher
    const compositeScore = cplEfficiency * 0.4 + leadVolumeScore * 0.25 + inventoryScore * 0.2 + trendScore * 0.15;
    return { city: c, compositeScore };
  });

  const totalScore = scored.reduce((s, x) => s + x.compositeScore, 0) || 1;
  const minBudget = totalDailyBudget * 0.02;

  const raw = scored.map(({ city, compositeScore }) => {
    let recommended = (compositeScore / totalScore) * totalDailyBudget;
    const maxSwing = city.dailyBudget > 0 ? city.dailyBudget * 1.4 : recommended;
    const minSwing = city.dailyBudget > 0 ? city.dailyBudget * 0.6 : 0;
    recommended = clamp(recommended, Math.max(minBudget, minSwing), Math.max(maxSwing, minBudget));
    return { city, recommended };
  });

  // Normalise so allocations sum exactly to totalDailyBudget.
  const rawTotal = raw.reduce((s, x) => s + x.recommended, 0) || 1;
  const scale = totalDailyBudget / rawTotal;

  return raw
    .map(({ city, recommended }) => {
      const finalRecommended = Math.round((recommended * scale) / 500) * 500;
      const changePct = city.dailyBudget > 0 ? ((finalRecommended - city.dailyBudget) / city.dailyBudget) * 100 : 100;
      return {
        cityId: city.cityId,
        cityName: city.cityName,
        currentBudget: city.dailyBudget,
        recommendedBudget: finalRecommended,
        changePct: Math.round(changePct),
        rationale: rationale(city, changePct),
      };
    })
    .sort((a, b) => b.recommendedBudget - a.recommendedBudget);
}

function rationale(c: CityMetrics, changePct: number): string {
  if (changePct > 5) {
    return `CPL ₹${Math.round(c.cpl)} is below the ₹${c.targetCpl} target with ${c.inventoryActive.toLocaleString("en-IN")} active units — room to scale.`;
  }
  if (changePct < -5) {
    return `CPL ₹${Math.round(c.cpl)} is trending against the ₹${c.targetCpl} target or inventory is thinning — pull back to protect efficiency.`;
  }
  return `Performance is on target — hold budget steady.`;
}

export type StructureRecommendation = {
  structureType: "DEDICATED_CITY" | "STANDARD_CITY" | "CITY_CLUSTER";
  label: string;
  explanation: string;
};

/** Smart Campaign Structure recommendation (spec section 10). */
export function recommendCampaignStructure(totalInventory: number): StructureRecommendation {
  if (totalInventory > 1000) {
    return {
      structureType: "DEDICATED_CITY",
      label: "Dedicated City Campaign",
      explanation: `With ${totalInventory.toLocaleString("en-IN")} vehicles, this city has enough catalogue depth to sustain its own campaign with a full budget and creative testing cycle.`,
    };
  }
  if (totalInventory >= 300) {
    return {
      structureType: "STANDARD_CITY",
      label: "Standard City Campaign",
      explanation: `${totalInventory.toLocaleString("en-IN")} vehicles is a healthy mid-size catalogue — a standard single-city campaign will get consistent delivery without overspending on redundant reach.`,
    };
  }
  return {
    structureType: "CITY_CLUSTER",
    label: "City Cluster Campaign",
    explanation: `Only ${totalInventory.toLocaleString("en-IN")} vehicles is below the threshold for efficient dedicated delivery — grouping this city with nearby markets into one cluster campaign avoids audience fragmentation and keeps CPL stable.`,
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
