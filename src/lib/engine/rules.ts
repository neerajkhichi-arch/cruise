import type { AdSetMetrics, CampaignMetrics, CityMetrics, VehicleMetrics } from "./types";
import {
  type AdSetSettings,
  type FunnelStage,
  type ResultType,
  canCompare,
  findUncontrolledVariables,
  geoRelation,
  RESULT_TYPE_LABEL,
} from "./classify";

export type RuleType =
  | "REDUCE_BUDGET_HIGH_CPL"
  | "INCREASE_BUDGET_LOW_CPL"
  | "DEACTIVATE_SOLD_VEHICLE"
  | "FLAG_NO_LEAD_VEHICLE"
  | "LOW_INVENTORY_WARNING"
  | "UNDERFUNDED_WINNER"
  | "GEO_SELF_COMPETITION"
  | "AUDIENCE_EXHAUSTION"
  | "UNCONTROLLED_TEST_VARIABLE";

export interface RuleParams {
  REDUCE_BUDGET_HIGH_CPL: { thresholdPct: number; minDays: number; budgetCutPct: number };
  INCREASE_BUDGET_LOW_CPL: { thresholdPct: number; budgetIncreasePct: number };
  DEACTIVATE_SOLD_VEHICLE: Record<string, never>;
  FLAG_NO_LEAD_VEHICLE: { spendThreshold: number };
  LOW_INVENTORY_WARNING: { minInventory: number };
  UNDERFUNDED_WINNER: { betterByPct: number; maxSpendShare: number; minResults: number };
  GEO_SELF_COMPETITION: Record<string, never>;
  AUDIENCE_EXHAUSTION: { frequencyCeiling: number };
  UNCONTROLLED_TEST_VARIABLE: { minAdSets: number };
}

export const DEFAULT_RULE_PARAMS: RuleParams = {
  REDUCE_BUDGET_HIGH_CPL: { thresholdPct: 20, minDays: 3, budgetCutPct: 15 },
  INCREASE_BUDGET_LOW_CPL: { thresholdPct: 20, budgetIncreasePct: 15 },
  DEACTIVATE_SOLD_VEHICLE: {},
  FLAG_NO_LEAD_VEHICLE: { spendThreshold: 500 },
  LOW_INVENTORY_WARNING: { minInventory: 300 },
  // Tuned against the live account: CHD-REM beats CHD-Combine-Audiences by ~39%
  // on an identical cohort while holding ~7% of the cohort's spend.
  UNDERFUNDED_WINNER: { betterByPct: 20, maxSpendShare: 0.35, minResults: 25 },
  GEO_SELF_COMPETITION: {},
  AUDIENCE_EXHAUSTION: { frequencyCeiling: 5 },
  UNCONTROLLED_TEST_VARIABLE: { minAdSets: 2 },
};

export interface RuleTrigger {
  ruleType: RuleType;
  scope: "CAMPAIGN" | "CITY" | "VEHICLE" | "ADSET" | "ACCOUNT";
  entityId: string;
  entityLabel: string;
  message: string;
  action: string;
  severity: "CRITICAL" | "WARNING" | "SUCCESS";
  suggestedDailyBudget?: number;
  /** Which comparison cohort the evidence came from, so a reviewer can check it. */
  evidenceCohort?: string;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/**
 * Rules 1 & 2 — CPL-driven budget rules.
 *
 * Now cohort-guarded. A campaign's cost-per-result is compared only against a
 * target expressed in the same result type and attribution window. Previously
 * this compared every campaign against a flat per-city CPL target, which fired
 * false CRITICALs on WhatsApp campaigns whose "cost per result" is a cost per
 * conversation and legitimately sits at a completely different level.
 */
export function evaluateCplRules(
  campaigns: CampaignMetrics[],
  params: Pick<RuleParams, "REDUCE_BUDGET_HIGH_CPL" | "INCREASE_BUDGET_LOW_CPL">,
  targetsByCohort: Map<string, number>
): RuleTrigger[] {
  const triggers: RuleTrigger[] = [];
  for (const c of campaigns) {
    if (c.status !== "ACTIVE" || c.leads < 5 || c.daysRunning < params.REDUCE_BUDGET_HIGH_CPL.minDays) continue;

    const target = targetsByCohort.get(c.cohort);
    if (target === undefined || target <= 0) {
      // No same-cohort benchmark exists. Staying silent is correct: inventing a
      // comparison against a different result type is how the old build produced
      // confident nonsense.
      continue;
    }

    const deltaPct = ((c.cpl - target) / target) * 100;
    const unit = RESULT_TYPE_LABEL[c.resultType];

    if (deltaPct > params.REDUCE_BUDGET_HIGH_CPL.thresholdPct) {
      const cut = params.REDUCE_BUDGET_HIGH_CPL.budgetCutPct;
      const newBudget = Math.round((c.dailyBudget * (1 - cut / 100)) / 100) * 100;
      triggers.push({
        ruleType: "REDUCE_BUDGET_HIGH_CPL",
        scope: "CAMPAIGN",
        entityId: c.campaignId,
        entityLabel: c.name,
        message: `${inr(c.cpl)} per ${unit.toLowerCase()} on ${c.attributionSetting}, ${Math.round(deltaPct)}% above the ${inr(target)} benchmark for the same cohort.`,
        action: `Reduce daily budget by ${cut}% (${inr(c.dailyBudget)} → ${inr(newBudget)}).`,
        severity: "CRITICAL",
        suggestedDailyBudget: newBudget,
        evidenceCohort: c.cohort,
      });
    } else if (deltaPct < -params.INCREASE_BUDGET_LOW_CPL.thresholdPct) {
      const inc = params.INCREASE_BUDGET_LOW_CPL.budgetIncreasePct;
      const newBudget = Math.round((c.dailyBudget * (1 + inc / 100)) / 100) * 100;
      triggers.push({
        ruleType: "INCREASE_BUDGET_LOW_CPL",
        scope: "CAMPAIGN",
        entityId: c.campaignId,
        entityLabel: c.name,
        message: `${inr(c.cpl)} per ${unit.toLowerCase()} on ${c.attributionSetting}, ${Math.round(Math.abs(deltaPct))}% below the ${inr(target)} same-cohort benchmark with healthy volume.`,
        action: `Increase daily budget by ${inc}% (${inr(c.dailyBudget)} → ${inr(newBudget)}).`,
        severity: "SUCCESS",
        suggestedDailyBudget: newBudget,
        evidenceCohort: c.cohort,
      });
    }
  }
  return triggers;
}

/** Rule 3 — sold vehicles must not keep spending. */
export function evaluateSoldVehicleRule(vehicles: VehicleMetrics[]): RuleTrigger[] {
  return vehicles
    .filter((v) => v.availability === "SOLD" && v.spend > 0)
    .map((v) => ({
      ruleType: "DEACTIVATE_SOLD_VEHICLE" as const,
      scope: "VEHICLE" as const,
      entityId: v.vehicleId,
      entityLabel: v.label,
      message: `${v.label} in ${v.cityName} is marked SOLD but is still receiving ad spend (${inr(v.spend)} so far).`,
      action: "Remove vehicle from the active catalogue set immediately.",
      severity: "CRITICAL" as const,
    }));
}

/** Rule 4 — flag vehicles burning spend with zero leads. */
export function evaluateNoLeadVehicleRule(
  vehicles: VehicleMetrics[],
  params: RuleParams["FLAG_NO_LEAD_VEHICLE"]
): RuleTrigger[] {
  return vehicles
    .filter((v) => v.availability === "ACTIVE" && v.spend > params.spendThreshold && v.leads === 0)
    .map((v) => ({
      ruleType: "FLAG_NO_LEAD_VEHICLE" as const,
      scope: "VEHICLE" as const,
      entityId: v.vehicleId,
      entityLabel: v.label,
      message: `${v.label} in ${v.cityName} has spent ${inr(v.spend)} with zero leads.`,
      action: "Lower exposure / exclude from catalogue set and review pricing or images.",
      severity: "WARNING" as const,
    }));
}

/** Rule 5 — low city inventory warning. */
export function evaluateLowInventoryRule(
  cities: CityMetrics[],
  params: RuleParams["LOW_INVENTORY_WARNING"]
): RuleTrigger[] {
  return cities
    // A city with no delivery has not "dropped" to zero inventory — it never
    // had any, because no catalogue feed is connected. Warning a city launched
    // minutes ago that it should cut budget is noise.
    .filter((c) => c.spend > 0 && c.inventoryActive < params.minInventory)
    .map((c) => ({
      ruleType: "LOW_INVENTORY_WARNING" as const,
      scope: "CITY" as const,
      entityId: c.cityId,
      entityLabel: c.cityName,
      message: `${c.cityName} active inventory has fallen to ${c.inventoryActive} units (below the ${params.minInventory} threshold).`,
      action: "Reduce spend or pause dedicated campaign until inventory recovers.",
      severity: "WARNING" as const,
    }));
}

/**
 * Rule 6 — an ad set that beats its own cohort but holds little of its budget.
 *
 * This is the rule the old build could not express, because it had no ad set
 * layer and no notion of a comparable cohort. In the live account it is the
 * highest-value finding: within PIXEL_LEAD::1d_click, the remarketing ad sets
 * in Nashik and Chandigarh beat the broad ad sets in the same cities while
 * holding a small fraction of the spend.
 */
export function evaluateUnderfundedWinnerRule(
  adSets: AdSetMetrics[],
  params: RuleParams["UNDERFUNDED_WINNER"]
): RuleTrigger[] {
  const triggers: RuleTrigger[] = [];
  const live = adSets.filter(
    (a) => a.status === "ACTIVE" && a.results >= params.minResults && a.costPerResult > 0 && a.cityName
  );

  // Grouped by city AND cohort. City, because budget cannot move between cities
  // — each one carries its own lead-supply commitment, so a cross-city
  // reallocation is not a recommendation anyone can act on. Cohort, because a
  // cost comparison across result types or attribution windows is meaningless.
  const groups = new Map<string, AdSetMetrics[]>();
  for (const a of live) {
    const key = `${a.cityName}::${a.cohort}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(a);
    else groups.set(key, [a]);
  }

  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const cohort = key.split("::").slice(1).join("::");

    for (const incumbent of members) {
      for (const challenger of members) {
        if (incumbent.adSetId === challenger.adSetId) continue;
        // The incumbent must genuinely hold the budget, and the challenger must
        // genuinely be cheaper — not merely different.
        if (incumbent.spend < challenger.spend * 2) continue;
        const betterBy = ((incumbent.costPerResult - challenger.costPerResult) / incumbent.costPerResult) * 100;
        if (betterBy < params.betterByPct) continue;
        if (!canCompare(incumbent, challenger).comparable) continue;

        const share = challenger.spend / (challenger.spend + incumbent.spend);
        if (share > params.maxSpendShare) continue;

        const move = Math.round(incumbent.spend * 0.2);
        const resultsGained = Math.round(move / challenger.costPerResult - move / incumbent.costPerResult);
        triggers.push({
          ruleType: "UNDERFUNDED_WINNER",
          scope: "ADSET",
          entityId: challenger.adSetId,
          entityLabel: `${challenger.name} · ${challenger.cityName}`,
          message: `${inr(challenger.costPerResult)} per result against ${inr(incumbent.costPerResult)} for ${incumbent.name} in the same city and the same cohort — ${Math.round(betterBy)}% cheaper — while holding ${inr(challenger.spend)} to its ${inr(incumbent.spend)}.`,
          action: `Move ${inr(move)} from ${incumbent.name} into this ad set. At current rates that is roughly ${resultsGained} extra results for the same spend. Watch frequency, now ${challenger.frequency.toFixed(1)}.`,
          severity: "SUCCESS",
          suggestedDailyBudget: Math.round(challenger.dailyBudget * 1.5),
          evidenceCohort: cohort,
        });
      }
    }
  }
  return triggers;
}

/**
 * Rule 7 — two live ad sets bidding for the same geography.
 * Catches the Mohali-inside-Chandigarh-region case, which no name-based check
 * could ever see.
 */
export interface AdSetFacts {
  campaignId: string;
  stage: FunnelStage;
  resultType: ResultType;
}

export function evaluateGeoSelfCompetitionRule(
  settings: AdSetSettings[],
  facts: Map<string, AdSetFacts>
): RuleTrigger[] {
  const live = settings.filter((s) => s.status === "ACTIVE");
  const triggers: RuleTrigger[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      const fa = facts.get(a.adSetId);
      const fb = facts.get(b.adSetId);
      if (!fa || !fb) continue;

      // Two ad sets deliberately covering the same city at different funnel
      // stages, or through different ad products, is structure — not a fault.
      // Only same-stage, same-product pairs actually bid against each other.
      if (fa.stage !== fb.stage || fa.resultType !== fb.resultType) continue;

      const relation = geoRelation(a, b);
      if (relation === "unrelated") continue;
      // Identical geo inside one campaign shares a budget, so it is a
      // structural choice rather than self-competition.
      if (relation === "identical" && fa.campaignId === fb.campaignId) continue;

      const key = [a.adSetId, b.adSetId].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);

      const aGeo = [...a.geoCities, ...a.geoRegions].join(", ") || "no geo set";
      const bGeo = [...b.geoCities, ...b.geoRegions].join(", ") || "no geo set";
      triggers.push({
        ruleType: "GEO_SELF_COMPETITION",
        scope: "ADSET",
        entityId: a.adSetId,
        entityLabel: `${a.name} ↔ ${b.name}`,
        message:
          relation === "nested"
            ? `${a.name} targets ${aGeo} and ${b.name} targets ${bGeo}; one sits inside the other. Both are live, at the same funnel stage, bidding for the same people.`
            : `${a.name} and ${b.name} target the same geography (${aGeo}) at the same funnel stage from two different campaigns. They bid against each other in the same auction.`,
        action:
          relation === "nested"
            ? "Exclude the narrower location from the broader ad set so each audience is bid for once."
            : "Consolidate the two into one ad set, or split the geography between them.",
        severity: "WARNING",
      });
    }
  }
  return triggers;
}

/**
 * Rule 8 — remarketing audience burning out.
 * A custom-audience ad set refills only as fast as site traffic does, so a high
 * frequency is a leading indicator of cost rising, not a vanity number.
 */
export function evaluateAudienceExhaustionRule(
  adSets: AdSetMetrics[],
  params: RuleParams["AUDIENCE_EXHAUSTION"]
): RuleTrigger[] {
  return adSets
    .filter((a) => a.status === "ACTIVE" && a.stage === "REMARKETING" && a.frequency >= params.frequencyCeiling)
    .map((a) => {
      const improving = a.costPerResult7d > 0 && a.costPerResult7d < a.costPerResult;
      return {
        ruleType: "AUDIENCE_EXHAUSTION" as const,
        scope: "ADSET" as const,
        entityId: a.adSetId,
        entityLabel: `${a.name}${a.cityName ? ` · ${a.cityName}` : ""}`,
        message: `Frequency ${a.frequency.toFixed(1)} against ${a.reach.toLocaleString("en-IN")} reach on a custom-audience ad set (${a.customAudiences.join(", ") || "unnamed audience"}). Cost per result is ${improving ? `still improving (${inr(a.costPerResult7d)} last 7d vs ${inr(a.costPerResult)} over 30d)` : `${inr(a.costPerResult7d)} last 7d vs ${inr(a.costPerResult)} over 30d`}.`,
        action: improving
          ? "Holding up for now — widen the audience window (90d → 180d site visitors) before scaling budget further, so headroom exists when it does turn."
          : "Refresh creative and widen the audience window; the pool is saturating.",
        severity: improving ? ("WARNING" as const) : ("CRITICAL" as const),
        evidenceCohort: a.cohort,
      };
    });
}

/**
 * Rule 9 — uncontrolled variables make a comparison unreadable.
 * Fires per city when live ad sets differ on age floor, gender or attribution,
 * because any performance gap then has more than one candidate cause.
 */
export function evaluateUncontrolledVariableRule(
  settingsByCity: Map<string, { cityName: string; settings: AdSetSettings[] }>,
  params: RuleParams["UNCONTROLLED_TEST_VARIABLE"]
): RuleTrigger[] {
  const triggers: RuleTrigger[] = [];
  for (const [cityId, { cityName, settings }] of settingsByCity) {
    const live = settings.filter((s) => s.status === "ACTIVE");
    if (live.length < params.minAdSets) continue;
    const variance = findUncontrolledVariables(live);
    if (variance.length === 0) continue;
    triggers.push({
      ruleType: "UNCONTROLLED_TEST_VARIABLE",
      scope: "CITY",
      // Must be the city's id, not its name — this is written to a foreign key.
      entityId: cityId,
      entityLabel: cityName,
      message: `${live.length} live ad sets in ${cityName} differ on ${variance.map((v) => `${v.field} (${v.values.join(" / ")})`).join(" and ")}. A cost difference between them cannot be attributed to structure while these also vary.`,
      action: "Hold age, gender and attribution constant across ad sets you intend to compare; vary one thing at a time.",
      severity: "WARNING",
    });
  }
  return triggers;
}

export interface RuleInput {
  campaigns: CampaignMetrics[];
  vehicles: VehicleMetrics[];
  cities: CityMetrics[];
  adSets: AdSetMetrics[];
  adSetSettings: AdSetSettings[];
  /** Spend-weighted cost per result per cohort key — the only valid benchmark. */
  targetsByCohort: Map<string, number>;
}

export function runAllRules(input: RuleInput, params: RuleParams = DEFAULT_RULE_PARAMS): RuleTrigger[] {
  const adSetFacts = new Map<string, AdSetFacts>(
    input.adSets.map((a) => [a.adSetId, { campaignId: a.campaignId, stage: a.stage, resultType: a.resultType }])
  );

  // Group by the city ROW the ad set belongs to, so downstream writes have a
  // real foreign key. Grouping by geo place name looked equivalent and was not:
  // "Nashik" is a label, not an id, and inserting it as one fails at the
  // database. Ad sets with no city row (no geo guardrail) are skipped.
  const settingsById = new Map(input.adSetSettings.map((s) => [s.adSetId, s]));
  const byCity = new Map<string, { cityName: string; settings: AdSetSettings[] }>();
  for (const a of input.adSets) {
    if (!a.cityId || !a.cityName) continue;
    const setting = settingsById.get(a.adSetId);
    if (!setting) continue;
    const bucket = byCity.get(a.cityId);
    if (bucket) bucket.settings.push(setting);
    else byCity.set(a.cityId, { cityName: a.cityName, settings: [setting] });
  }

  return [
    ...evaluateCplRules(input.campaigns, params, input.targetsByCohort),
    ...evaluateSoldVehicleRule(input.vehicles),
    ...evaluateNoLeadVehicleRule(input.vehicles, params.FLAG_NO_LEAD_VEHICLE),
    ...evaluateLowInventoryRule(input.cities, params.LOW_INVENTORY_WARNING),
    ...evaluateUnderfundedWinnerRule(input.adSets, params.UNDERFUNDED_WINNER),
    ...evaluateGeoSelfCompetitionRule(input.adSetSettings, adSetFacts),
    ...evaluateAudienceExhaustionRule(input.adSets, params.AUDIENCE_EXHAUSTION),
    ...evaluateUncontrolledVariableRule(byCity, params.UNCONTROLLED_TEST_VARIABLE),
  ];
}
