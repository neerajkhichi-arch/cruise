import type { VehicleMetrics } from "./types";

/**
 * Vehicle Performance Score (0-100)
 * Weighted blend of: CTR, CPL efficiency, lead rate, inventory age,
 * price competitiveness vs. the city average for the same model, and a
 * mild recency/historical stability factor.
 *
 * Weights are intentionally simple/explainable (per spec section 17) so
 * the score can be justified to a marketer, not a black box.
 */
type ScorableVehicle = Omit<VehicleMetrics, "performanceScore" | "healthScore">;

export function vehiclePerformanceScore(v: ScorableVehicle, cityTargetCpl: number): number {
  const leadRate = v.clicks > 0 ? v.leads / v.clicks : 0;
  const ctrScore = clamp01(v.ctr / 3.5) * 100; // 3.5% CTR treated as "excellent"
  const cplScore = v.leads === 0 ? 15 : clamp01(cityTargetCpl / Math.max(v.cpl, 1)) * 100;
  const leadRateScore = clamp01(leadRate / 0.12) * 100; // 12% click->lead treated as excellent
  const ageScore = 100 - clamp01(v.inventoryAgeDays / 90) * 100; // fresher is better
  const priceScore = v.cityAvgPrice > 0
    ? 100 - clamp01(Math.abs(v.price - v.cityAvgPrice) / v.cityAvgPrice / 0.35) * 100
    : 60;
  const noSpendPenalty = v.spend > 500 && v.leads === 0 ? -20 : 0;

  const raw =
    ctrScore * 0.22 +
    cplScore * 0.3 +
    leadRateScore * 0.23 +
    ageScore * 0.15 +
    priceScore * 0.1 +
    noSpendPenalty;

  return Math.round(clamp(raw, 0, 100));
}

/**
 * Inventory Health Score (0-100)
 * Reflects how "advertisable" a vehicle is: fresh listing, active
 * availability, no stale price, and reasonable spend efficiency.
 */
export function inventoryHealthScore(input: {
  availability: "ACTIVE" | "SOLD" | "RESERVED";
  inventoryAgeDays: number;
  hasRecentPriceChange: boolean;
  spend: number;
  leads: number;
  hasImages: boolean;
}): number {
  if (input.availability === "SOLD") return 0;

  let score = 100;
  if (input.inventoryAgeDays > 60) score -= 35;
  else if (input.inventoryAgeDays > 30) score -= 15;

  if (input.spend > 500 && input.leads === 0) score -= 25;
  if (!input.hasImages) score -= 20;
  if (input.availability === "RESERVED") score -= 10;

  return Math.round(clamp(score, 0, 100));
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
function clamp01(n: number) {
  return clamp(n, 0, 1.15);
}
