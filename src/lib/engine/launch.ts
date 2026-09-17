/**
 * New-city launch rules.
 *
 * This is the City Launch Playbook (2026-09-01) expressed as code. Every
 * threshold below is derived from the live account rather than chosen, and the
 * derivation is recorded next to it so a reader can check it instead of
 * trusting it.
 *
 * The three decisions this module encodes, in the order the wizard applies them:
 *   1. A city may not receive budget until someone has written a CPL ceiling.
 *   2. Budget must clear the learning-phase floor, or the launch is restructured
 *      rather than merely warned about.
 *   3. Both launch ad sets hold every setting constant except audience, so the
 *      day-14 comparison is readable.
 */

import type { AdSetSettings, AttributionSetting, ResultType } from "./classify";
import { geoRelation } from "./classify";
import { cityFilterRule } from "../../../scripts/real-catalogue-data";

// ---------------------------------------------------------------------------
// Benchmarks — measured, 30 days to 2026-09-01, PIXEL_LEAD::1d_click cohort
// ---------------------------------------------------------------------------

/** Spend-weighted cost per result across the whole cohort: ₹1,69,394 / 3,133. */
export const COHORT_BENCHMARK = 54;

/**
 * Multipliers of the cohort benchmark, by what an ad set actually is.
 * Prospecting  ×1.66 — Nashik ₹81, Chandigarh ₹102 (₹96,783 / 1,076)
 * Remarketing, first months ×1.19 — Nashik ₹63, Chandigarh ₹67 (₹12,839 / 200)
 * Remarketing, mature ×0.60 — Ahmedabad only (₹59,771 / 1,857)
 */
export const STAGE_MULTIPLIER = {
  PROSPECTING: 1.66,
  REMARKETING_YOUNG: 1.19,
  REMARKETING_MATURE: 0.6,
} as const;

/** A new ad set has no conversion history; the first month costs more. */
export const LEARNING_PREMIUM = 0.2;

/** Meta needs ~50 optimisation events per ad set per week to exit learning. */
export const LEARNING_CONVERSIONS_PER_WEEK = 50;

export type LaunchAdSetKind = "BROAD" | "LOOKALIKE" | "REMARKETING";

export interface CeilingLadder {
  month1: number | null;
  month2to3: number;
  steadyState: number;
}

/**
 * The ceiling a given ad set kind is held to, by city age.
 * Remarketing has no month-1 figure because a new city has no audience to
 * remarket to — it opens around day 30 (see `remarketingReadiness`).
 */
export function ceilingLadder(kind: LaunchAdSetKind): CeilingLadder {
  const prospecting = Math.round(COHORT_BENCHMARK * STAGE_MULTIPLIER.PROSPECTING);
  switch (kind) {
    case "BROAD":
      return {
        month1: Math.round(prospecting * (1 + LEARNING_PREMIUM) / 5) * 5,
        month2to3: 95,
        steadyState: prospecting,
      };
    case "LOOKALIKE":
      // A seeded lookalike is prospecting-class in cost terms — it reaches
      // people who have never touched the site. Benchmarking it against
      // Ahmedabad's ₹32 remarketing figure manufactures a false failure.
      return {
        month1: Math.round(prospecting * (1 + LEARNING_PREMIUM) / 5) * 5,
        month2to3: 90,
        steadyState: 80,
      };
    case "REMARKETING":
      return {
        month1: null,
        month2to3: 75,
        steadyState: Math.round(COHORT_BENCHMARK * STAGE_MULTIPLIER.REMARKETING_YOUNG / 5) * 5,
      };
  }
}

/** Daily spend one ad set needs to clear the learning phase at a given ceiling. */
export function learningFloorPerAdSet(ceiling: number): number {
  return Math.ceil((LEARNING_CONVERSIONS_PER_WEEK * ceiling) / 7);
}

// ---------------------------------------------------------------------------
// Launch constants — held identical across both launch ad sets
// ---------------------------------------------------------------------------

export interface LaunchConstants {
  ageMin: number;
  ageMax: number;
  genders: number[];
  attributionSetting: AttributionSetting;
  optimizationGoal: string;
  resultType: ResultType;
  advantageAudience: boolean;
  targetingOptimization: string;
}

/**
 * Audience is the only variable at launch. Everything here is locked because
 * the account's existing tests are unreadable without it: Nashik's five live
 * ad sets differ simultaneously on age floor (18/24/25), gender (men/all) and
 * attribution window (three of them), so no cost gap between them has a single
 * explanation.
 *
 * Values match the account's two best consolidated ad sets, Ahmedabad and Nashik.
 */
export const LAUNCH_CONSTANTS: LaunchConstants = {
  ageMin: 24,
  ageMax: 65,
  genders: [1],
  attributionSetting: "1d_click",
  optimizationGoal: "OFFSITE_CONVERSIONS",
  resultType: "PIXEL_LEAD",
  advantageAudience: true,
  targetingOptimization: "expansion_all",
};

export const CONSTANT_RATIONALE: Record<keyof LaunchConstants, string> = {
  ageMin: "Matches the account's two best consolidated ad sets (Ahmedabad, Nashik).",
  ageMax: "Matches the account's two best consolidated ad sets (Ahmedabad, Nashik).",
  genders: "What the current top performers run. Change it as a deliberate test, not incidentally.",
  attributionSetting:
    "The cohort every benchmark here lives in. A wider window counts more conversions for identical delivery and silently flatters the ad set.",
  optimizationGoal: "Optimise for the lead itself, not link clicks or landing page views.",
  resultType: "UCR_Lead_Submit_New — the account's website lead event.",
  advantageAudience: "Matches existing structure. Restricting it is a separate test.",
  targetingOptimization: "Matches existing structure. Restricting it is a separate test.",
};

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export type GateStatus = "PASS" | "WARN" | "BLOCK";

export interface Gate {
  id: string;
  title: string;
  status: GateStatus;
  detail: string;
  /** What to do about it, when it isn't already passing. */
  remedy?: string;
}

export interface LaunchPlanInput {
  cityName: string;
  /** Written by the user. The launch is blocked until this exists. */
  cplCeiling: number | null;
  /** Total daily budget across all launch ad sets. */
  dailyBudget: number;
  adSetKinds: LaunchAdSetKind[];
  /** Confirmed by the operator: a real test lead was recorded for this city. */
  pixelVerified: boolean;
  /** The catalogue and product set the ad sets will be bound to. */
  catalogue: { catalogueId: string; catalogueName: string; vertical: string; inUse: boolean } | null;
  productSet: {
    productSetId: string;
    name: string;
    productCount: number;
    filterRule: string;
    cityKey: string | null;
  } | null;
  /** Every live ad set in the account, for the geo audit. */
  existingAdSets: AdSetSettings[];
  /** Geo the new campaign will target — city name, plus any parent region. */
  targetGeo: { cities: string[]; regions: string[] };
}

export interface LaunchPlan {
  gates: Gate[];
  /** True when nothing is BLOCK. WARNs do not stop a launch. */
  canLaunch: boolean;
  floorPerAdSet: number;
  floorTotal: number;
  budgetPerAdSet: number;
  /** Projected conversions per ad set per week at the ceiling. */
  projectedWeeklyConversions: number;
  /** Ad sets this budget can actually support at the floor. */
  supportedAdSets: number;
  geoConflicts: { adSetName: string; theirGeo: string[]; relation: string }[];
  /** Real inventory for this city, from the product set. 0 when unselected. */
  productCount: number;
}

/** Below this, a catalogue is too thin for the algorithm to work with. */
export const MIN_PRODUCT_SET_SIZE = 300;

export function buildLaunchPlan(input: LaunchPlanInput): LaunchPlan {
  const gates: Gate[] = [];
  const kindCount = Math.max(1, input.adSetKinds.length);

  // --- Gate 1: the ceiling. The only hard entry condition. ----------------
  if (input.cplCeiling === null || !Number.isFinite(input.cplCeiling) || input.cplCeiling <= 0) {
    gates.push({
      id: "ceiling",
      title: "CPL ceiling",
      status: "BLOCK",
      detail: `No ceiling has been written for ${input.cityName}.`,
      remedy:
        "Set the month-1 ceiling. Budget sizing, the day-14 decision and every alert threshold read from this number; without it each of those becomes an argument.",
    });
  } else {
    gates.push({
      id: "ceiling",
      title: "CPL ceiling",
      status: "PASS",
      detail: `₹${input.cplCeiling} per website lead on 1d_click for month 1.`,
    });
  }

  const ceiling = input.cplCeiling ?? 0;
  const floorPerAdSet = ceiling > 0 ? learningFloorPerAdSet(ceiling) : 0;
  const floorTotal = floorPerAdSet * kindCount;
  const budgetPerAdSet = Math.floor(input.dailyBudget / kindCount);
  const projectedWeeklyConversions = ceiling > 0 ? Math.floor((budgetPerAdSet * 7) / ceiling) : 0;
  const supportedAdSets = floorPerAdSet > 0 ? Math.floor(input.dailyBudget / floorPerAdSet) : 0;

  // --- Gate 2: the learning-phase floor. -----------------------------------
  if (ceiling > 0) {
    if (input.dailyBudget >= floorTotal) {
      gates.push({
        id: "floor",
        title: "Learning-phase budget",
        status: "PASS",
        detail: `₹${input.dailyBudget.toLocaleString("en-IN")}/day across ${kindCount} ad set${kindCount === 1 ? "" : "s"} clears the ₹${floorTotal.toLocaleString("en-IN")}/day floor. Each ad set should reach ~${projectedWeeklyConversions} conversions a week against the ${LEARNING_CONVERSIONS_PER_WEEK} needed.`,
      });
    } else if (supportedAdSets >= 1) {
      gates.push({
        id: "floor",
        title: "Learning-phase budget",
        status: "BLOCK",
        detail: `₹${input.dailyBudget.toLocaleString("en-IN")}/day split ${kindCount} ways gives each ad set ₹${budgetPerAdSet.toLocaleString("en-IN")}/day — about ${projectedWeeklyConversions} conversions a week against the ${LEARNING_CONVERSIONS_PER_WEEK} needed to leave the learning phase.`,
        remedy: `Either raise the budget to ₹${floorTotal.toLocaleString("en-IN")}/day, or launch ${supportedAdSets} ad set${supportedAdSets === 1 ? "" : "s"} at ₹${floorPerAdSet.toLocaleString("en-IN")}/day. Two underfunded ad sets both stall and you learn nothing about either — sequencing beats splitting when budget is thin.`,
      });
    } else {
      gates.push({
        id: "floor",
        title: "Learning-phase budget",
        status: "BLOCK",
        detail: `₹${input.dailyBudget.toLocaleString("en-IN")}/day cannot sustain even one ad set through the learning phase at a ₹${ceiling} ceiling.`,
        remedy: `One ad set needs ₹${floorPerAdSet.toLocaleString("en-IN")}/day. Below that, delivery stays unstable and the reported cost is noise you cannot act on.`,
      });
    }
  }

  // --- Gate 3: the catalogue binding. -------------------------------------
  //
  // A dynamic catalogue ad has no creative of its own — the product set IS the
  // creative. Without both a catalogue and a product set the ad set cannot be
  // completed in Ads Manager at all, so this is a block, not a warning.
  if (!input.catalogue) {
    gates.push({
      id: "catalogue",
      title: "Catalogue",
      status: "BLOCK",
      detail: "No catalogue selected.",
      remedy:
        "Pick the vehicles catalogue the live campaigns run against. A catalogue ad draws its creative from the product feed; without one there is nothing to show.",
    });
  } else if (!input.productSet) {
    gates.push({
      id: "catalogue",
      title: "Product set",
      status: "BLOCK",
      detail: `${input.catalogue.catalogueName} is selected, but no product set for ${input.cityName}.`,
      remedy: `Create a dynamic product set in that catalogue filtered on ${cityFilterRule(input.cityName)}, then select it here. This is how every existing city is set up — Mohali's set was created the day its campaign launched.`,
    });
  } else {
    const ps = input.productSet;
    const expected = cityFilterRule(input.cityName);
    const notes: string[] = [];
    let status: GateStatus = "PASS";

    if (ps.cityKey === null) {
      status = "WARN";
      notes.push(
        `"${ps.name}" has no city filter, so it serves the whole ${ps.productCount.toLocaleString("en-IN")}-vehicle catalogue into a ${input.cityName} ad set. Buyers will see cars they cannot travel to.`
      );
    } else if (ps.cityKey.toLowerCase() !== input.cityName.trim().toLowerCase()) {
      status = "WARN";
      notes.push(
        `"${ps.name}" filters on ${ps.filterRule}, which does not match ${input.cityName}. Expected ${expected}.`
      );
    }

    if (ps.productCount === 0) {
      // A set that matches nothing produces a campaign that is created,
      // approved, and serves an empty carousel — a failure invisible until
      // somebody wonders why a live campaign has no impressions. Refuse it
      // here rather than at the API call.
      status = "BLOCK";
      notes.push(
        `"${ps.name}" matches 0 vehicles, so the ad would have nothing to show. Record the real count, or get the city's stock into the catalogue first.`
      );
    } else if (ps.productCount < MIN_PRODUCT_SET_SIZE) {
      status = status === "PASS" ? "WARN" : status;
      notes.push(
        `${ps.productCount.toLocaleString("en-IN")} vehicles is below the ${MIN_PRODUCT_SET_SIZE}-unit threshold — thin catalogues repeat creative and fatigue faster.`
      );
    }

    if (input.catalogue.inUse === false) {
      // Never downgrade an existing BLOCK to a warning.
      status = status === "BLOCK" ? "BLOCK" : "WARN";
      notes.push(
        `${input.catalogue.catalogueName} is not the catalogue the live campaigns run against. Check this is deliberate.`
      );
    }

    gates.push({
      id: "catalogue",
      title: "Catalogue and product set",
      status,
      detail:
        status === "PASS"
          ? `${input.catalogue.catalogueName} → "${ps.name}", ${ps.productCount.toLocaleString("en-IN")} vehicles filtered on ${ps.filterRule}.`
          : `${input.catalogue.catalogueName} → "${ps.name}". ${notes.join(" ")}`,
      remedy: status === "PASS" ? undefined : "Fix the product set before launch, or the ads will serve the wrong inventory.",
    });
  }

  // --- Gate 4: the pixel. Not a blocker, but a ceiling you can't measure ---
  gates.push(
    input.pixelVerified
      ? {
          id: "pixel",
          title: "Conversion tracking",
          status: "PASS",
          detail: "A test lead was recorded against UCR_Lead_Submit_New for this city.",
        }
      : {
          id: "pixel",
          title: "Conversion tracking",
          status: "WARN",
          detail: "No test lead has been confirmed for this city.",
          remedy:
            "Submit a live form from the new city and confirm UCR_Lead_Submit_New records it. A ceiling you cannot measure is decoration.",
        }
  );

  // --- Gate 5: the geo audit. ---------------------------------------------
  const probe: AdSetSettings = {
    adSetId: "__new__",
    name: "__new__",
    status: "ACTIVE",
    optimizationGoal: LAUNCH_CONSTANTS.optimizationGoal,
    attributionSetting: LAUNCH_CONSTANTS.attributionSetting,
    resultType: LAUNCH_CONSTANTS.resultType,
    geoCities: input.targetGeo.cities,
    geoRegions: input.targetGeo.regions,
    customAudiences: [],
    excludedAudiences: [],
    lookalikeSource: null,
    catalogueId: input.catalogue?.catalogueId ?? null,
    catalogueName: input.catalogue?.catalogueName ?? null,
    productSetId: input.productSet?.productSetId ?? null,
    productSetName: input.productSet?.name ?? null,
    productSetFilter: input.productSet?.filterRule ?? null,
    productCount: input.productSet?.productCount ?? 0,
    interests: [],
    ageMin: LAUNCH_CONSTANTS.ageMin,
    ageMax: LAUNCH_CONSTANTS.ageMax,
    genders: LAUNCH_CONSTANTS.genders,
    advantageAudience: LAUNCH_CONSTANTS.advantageAudience,
    targetingOptimization: LAUNCH_CONSTANTS.targetingOptimization,
  };

  const geoConflicts = input.existingAdSets
    .filter((a) => a.status === "ACTIVE")
    .map((a) => ({ adSet: a, relation: geoRelation(probe, a) }))
    .filter((x) => x.relation !== "unrelated")
    .map((x) => ({
      adSetName: x.adSet.name,
      theirGeo: [...x.adSet.geoCities, ...x.adSet.geoRegions],
      relation: x.relation,
    }));

  gates.push(
    geoConflicts.length === 0
      ? {
          id: "geo",
          title: "Geo audit",
          status: "PASS",
          detail: "No live ad set already targets this city or a region containing it.",
        }
      : {
          id: "geo",
          title: "Geo audit",
          status: "WARN",
          detail: `${geoConflicts.length} live ad set${geoConflicts.length === 1 ? "" : "s"} already reach${geoConflicts.length === 1 ? "es" : ""} this geography: ${geoConflicts.map((c) => `${c.adSetName} (${c.theirGeo.join(", ") || "no geo set"})`).join("; ")}.`,
          remedy:
            "Exclude the new city from those ad sets before launch, or they will bid against this campaign in the same auction. This has already happened once on this account — Chandigarh's region targeting contains Mohali.",
        }
  );

  return {
    gates,
    canLaunch: !gates.some((g) => g.status === "BLOCK"),
    floorPerAdSet,
    floorTotal,
    budgetPerAdSet,
    projectedWeeklyConversions,
    supportedAdSets,
    geoConflicts,
    productCount: input.productSet?.productCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Remarketing readiness — the day-30 question
// ---------------------------------------------------------------------------

export interface RemarketingReadiness {
  ready: boolean;
  audienceSize: number | null;
  detail: string;
}

/** Meta will deliver against 1,000; in practice an ad set wants far more. */
export const REMARKETING_MIN_AUDIENCE = 1000;
export const REMARKETING_HEALTHY_AUDIENCE = 10000;

export function remarketingReadiness(audienceSize: number | null): RemarketingReadiness {
  if (audienceSize === null) {
    return {
      ready: false,
      audienceSize: null,
      detail:
        "Audience size is unknown. It needs monthly unique visitors to car detail pages from this city — pull it from analytics so the day-30 check confirms rather than discovers.",
    };
  }
  if (audienceSize < REMARKETING_MIN_AUDIENCE) {
    return {
      ready: false,
      audienceSize,
      detail: `${audienceSize.toLocaleString("en-IN")} people — below the ${REMARKETING_MIN_AUDIENCE.toLocaleString("en-IN")} Meta needs to deliver at all. Keep the audience filling.`,
    };
  }
  if (audienceSize < REMARKETING_HEALTHY_AUDIENCE) {
    return {
      ready: false,
      audienceSize,
      detail: `${audienceSize.toLocaleString("en-IN")} people — deliverable but thin. Wait for ${REMARKETING_HEALTHY_AUDIENCE.toLocaleString("en-IN")} before giving it a separate budget.`,
    };
  }
  return {
    ready: true,
    audienceSize,
    detail: `${audienceSize.toLocaleString("en-IN")} people. Open a remarketing ad set at ₹500/day, same age, gender and attribution as the other two. Expect ₹64–75, not Ahmedabad's ₹32 — that took months of accumulation.`,
  };
}

// ---------------------------------------------------------------------------
// The generated launch structure
// ---------------------------------------------------------------------------

export interface PlannedAdSet {
  kind: LaunchAdSetKind;
  name: string;
  productSetName: string | null;
  productCount: number;
  audienceDescription: string;
  customAudiences: string[];
  lookalikeSource: string | null;
  dailyBudget: number;
  ceiling: number;
}

/** The custom audience a city's remarketing ad set will eventually use. */
export function pvAudienceName(cityName: string): string {
  return `CD-FB-Buy Used Car-PV-${cityName.toLowerCase().replace(/\s+/g, "-")}-90Days-New`;
}

export function planAdSets(
  cityName: string,
  kinds: LaunchAdSetKind[],
  dailyBudget: number,
  lookalikeSourceCities: string[],
  productSet?: { name: string; productCount: number } | null
): PlannedAdSet[] {
  const per = Math.floor(dailyBudget / Math.max(1, kinds.length));
  const psName = productSet?.name ?? null;
  const psCount = productSet?.productCount ?? 0;
  return kinds.map((kind) => {
    const ladder = ceilingLadder(kind);
    if (kind === "BROAD") {
      return {
        kind,
        productSetName: psName,
        productCount: psCount,
        name: `${cityName} · Broad`,
        audienceDescription: "No custom audience. Advantage+ audience on, no interest layer.",
        customAudiences: [],
        lookalikeSource: null,
        dailyBudget: per,
        ceiling: ladder.month1 ?? ladder.steadyState,
      };
    }
    if (kind === "LOOKALIKE") {
      return {
        kind,
        productSetName: psName,
        productCount: psCount,
        name: `${cityName} · Lookalike`,
        audienceDescription: `1% lookalike, India, seeded from UCR_Lead_Submit_New converters in ${lookalikeSourceCities.join(", ")}.`,
        customAudiences: [],
        lookalikeSource: lookalikeSourceCities.join(", "),
        dailyBudget: per,
        ceiling: ladder.month1 ?? ladder.steadyState,
      };
    }
    return {
      kind,
      productSetName: psName,
      productCount: psCount,
      name: `${cityName} · Remarketing`,
      audienceDescription: `90-day page visitors from ${cityName}.`,
      customAudiences: [pvAudienceName(cityName)],
      lookalikeSource: null,
      dailyBudget: per,
      ceiling: ladder.month2to3,
    };
  });
}
