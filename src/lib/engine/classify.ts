/**
 * Classification and comparison safety.
 *
 * Rebuilt 2026-09-01 after auditing the live "Used Cars Sales" account
 * (ad_account_id 10153410655459601). The previous build inferred a campaign's
 * funnel stage and city from its NAME. That is not survivable in this account:
 *
 *   - "Combined Aud.Catalogue" (Ahmedabad) sounds like a broad/consolidated
 *     campaign but carries the custom audience
 *     CD-FB-Buy Used Car-PV-ahmedabad-90Days-New. It is remarketing.
 *   - "CHD-Remarketing" carries NO custom audience at all. It is prospecting.
 *   - "CHD-Detailed-Audience" is geo-targeted at Nashik, not Chandigarh.
 *   - Two different ad sets are both named "Nashik-Catalogue - Detailed-Targeting"
 *     with different age floors.
 *
 * Everything here derives from the ad set's actual delivery settings. Nothing
 * in this file may read `name`.
 */

export type FunnelStage = "PROSPECTING" | "REMARKETING";

/**
 * Where an ad set's audience comes from. Finer than FunnelStage: a lookalike is
 * prospecting in cost terms (it reaches people who have never touched the site)
 * but is a different audience strategy, and the launch A/B compares exactly
 * these two. Derived from settings, never from the name.
 */
export type AudienceSource = "BROAD" | "LOOKALIKE" | "REMARKETING";

/** The result each ad set is actually optimising for. These are NOT interchangeable. */
export type ResultType = "PIXEL_LEAD" | "MESSAGING" | "LEAD_FORM";

export type AttributionSetting =
  | "1d_click"
  | "1d_view_7d_click"
  | "7d_click_1d_ev"
  | "1d_view_7d_click_1d_ev";

/** The delivery settings we classify from — mirrors the Meta ad set targeting spec. */
export interface AdSetSettings {
  adSetId: string;
  name: string;
  status: "ACTIVE" | "PAUSED";
  optimizationGoal: string;
  attributionSetting: AttributionSetting;
  resultType: ResultType;
  geoCities: string[];
  geoRegions: string[];
  customAudiences: string[];
  excludedAudiences: string[];
  /** Seed for a lookalike audience; null for broad and remarketing. */
  lookalikeSource: string | null;
  catalogueId: string | null;
  catalogueName: string | null;
  productSetId: string | null;
  productSetName: string | null;
  productSetFilter: string | null;
  productCount: number;
  interests: string[];
  ageMin: number;
  ageMax: number;
  /** [] means all genders; [1] men; [2] women. */
  genders: number[];
  advantageAudience: boolean;
  targetingOptimization: string | null;
}

export const RESULT_TYPE_LABEL: Record<ResultType, string> = {
  PIXEL_LEAD: "Website lead (UCR_Lead_Submit_New)",
  MESSAGING: "Messaging conversation started",
  LEAD_FORM: "Lead form submission",
};

/** Map a raw Meta result indicator onto our enum. */
export function toResultType(indicator: string): ResultType {
  if (indicator.includes("messaging_conversation")) return "MESSAGING";
  if (indicator.includes("leadgen") || indicator === "other") return "LEAD_FORM";
  return "PIXEL_LEAD";
}

/**
 * Funnel stage comes from whether the ad set is anchored on a custom audience.
 * A populated custom_audiences array means we are re-reaching people who already
 * touched the site; empty means we are prospecting. The name is irrelevant.
 */
export function classifyFunnelStage(s: Pick<AdSetSettings, "customAudiences">): FunnelStage {
  return s.customAudiences.length > 0 ? "REMARKETING" : "PROSPECTING";
}

/**
 * The finer classification. A populated custom audience means remarketing; a
 * lookalike seed means lookalike; neither means broad. Order matters — an ad
 * set carrying both is remarketing, because the custom audience is what
 * actually constrains delivery.
 */
export function classifyAudienceSource(
  s: Pick<AdSetSettings, "customAudiences" | "lookalikeSource">
): AudienceSource {
  if (s.customAudiences.length > 0) return "REMARKETING";
  if (s.lookalikeSource) return "LOOKALIKE";
  return "BROAD";
}

/**
 * Geo comes from the targeting spec, not the name. An ad set may carry both a
 * city and a region; both are returned so overlap detection can see them.
 * Returns [] for ad sets with no geo constraint at all (these exist in the
 * account — e.g. the AHM WhatsApp remarketing ad set relies on a city-scoped
 * custom audience for its geo, with no geo guardrail of its own).
 */
export function resolveGeo(s: Pick<AdSetSettings, "geoCities" | "geoRegions">): string[] {
  return [...s.geoCities, ...s.geoRegions];
}

export function hasGeoGuardrail(s: Pick<AdSetSettings, "geoCities" | "geoRegions">): boolean {
  return resolveGeo(s).length > 0;
}

/**
 * A comparison cohort. Cost-per-result is only meaningful between ad sets that
 * share BOTH the result type and the attribution window — otherwise you are
 * comparing a 1-day-click website lead against a 7-day-click-plus-view WhatsApp
 * conversation and calling the difference performance.
 */
export function cohortKey(s: Pick<AdSetSettings, "resultType" | "attributionSetting">): string {
  return `${s.resultType}::${s.attributionSetting}`;
}

export interface ComparabilityVerdict {
  comparable: boolean;
  /** Present when comparable === false: why the comparison was refused. */
  reason?: string;
}

/** Guard. Call this before any cost-per-result comparison. */
export function canCompare(
  a: Pick<AdSetSettings, "resultType" | "attributionSetting">,
  b: Pick<AdSetSettings, "resultType" | "attributionSetting">
): ComparabilityVerdict {
  if (a.resultType !== b.resultType) {
    return {
      comparable: false,
      reason: `Different result types (${RESULT_TYPE_LABEL[a.resultType]} vs ${RESULT_TYPE_LABEL[b.resultType]}) — the costs are not the same unit.`,
    };
  }
  if (a.attributionSetting !== b.attributionSetting) {
    return {
      comparable: false,
      reason: `Different attribution windows (${a.attributionSetting} vs ${b.attributionSetting}) — a wider window counts more conversions for the same delivery.`,
    };
  }
  return { comparable: true };
}

/** Split a set of ad sets into comparable cohorts. */
export function groupIntoCohorts<T extends Pick<AdSetSettings, "resultType" | "attributionSetting">>(
  items: T[]
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const key = cohortKey(item);
    const bucket = out.get(key);
    if (bucket) bucket.push(item);
    else out.set(key, [item]);
  }
  return out;
}

/**
 * Two ad sets overlap in geo when one targets a city that sits inside a region
 * the other targets, or when they target the same place outright. In the live
 * account, several Chandigarh ad sets target cities:[Mohali] + regions:[Chandigarh]
 * while a separate Mohali campaign also runs — they bid against each other.
 */
const CITY_WITHIN_REGION: Record<string, string> = {
  Mohali: "Chandigarh",
  Chandigarh: "Chandigarh",
  Ahmedabad: "Gujarat",
  Nashik: "Maharashtra",
};

export type GeoRelation = "identical" | "nested" | "unrelated";

/** Resolve a place to the region that contains it, for nesting checks. */
function parentOf(place: string): string | undefined {
  return CITY_WITHIN_REGION[place];
}

/**
 * How two ad sets' geo targeting relate.
 *  - "identical": the same set of places.
 *  - "nested": one targets a place that sits inside a place the other targets
 *    (e.g. cities:[Mohali] against regions:[Chandigarh]). This is the case that
 *    matters most: the broader ad set is bidding on the narrower one's people
 *    without anyone having decided that it should.
 */
export function geoRelation(a: AdSetSettings, b: AdSetSettings): GeoRelation {
  const aPlaces = new Set(resolveGeo(a));
  const bPlaces = new Set(resolveGeo(b));
  if (aPlaces.size === 0 || bPlaces.size === 0) return "unrelated";

  const same = aPlaces.size === bPlaces.size && [...aPlaces].every((p) => bPlaces.has(p));
  if (same) return "identical";

  const aInsideB = [...aPlaces].some((p) => bPlaces.has(p) || (parentOf(p) !== undefined && bPlaces.has(parentOf(p)!)));
  const bInsideA = [...bPlaces].some((p) => aPlaces.has(p) || (parentOf(p) !== undefined && aPlaces.has(parentOf(p)!)));
  return aInsideB || bInsideA ? "nested" : "unrelated";
}

/** Kept for callers that only need a yes/no. */
export function geoOverlaps(a: AdSetSettings, b: AdSetSettings): boolean {
  return geoRelation(a, b) !== "unrelated";
}

/** Settings that should be held constant across ad sets so tests stay readable. */
export interface TargetingVariance {
  field: string;
  values: string[];
}

export function findUncontrolledVariables(adSets: AdSetSettings[]): TargetingVariance[] {
  const out: TargetingVariance[] = [];
  const ageFloors = [...new Set(adSets.map((a) => a.ageMin))].sort((x, y) => x - y);
  if (ageFloors.length > 1) out.push({ field: "Age floor", values: ageFloors.map(String) });
  const genderSets = [...new Set(adSets.map((a) => (a.genders.length === 0 ? "all" : a.genders.join("+"))))];
  if (genderSets.length > 1) out.push({ field: "Gender targeting", values: genderSets });
  const attribution = [...new Set(adSets.map((a) => a.attributionSetting))];
  if (attribution.length > 1) out.push({ field: "Attribution window", values: attribution });
  return out;
}
