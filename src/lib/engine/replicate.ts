/**
 * Replicating a campaign into new cities.
 *
 * The operator picks one existing campaign and a list of cities. Everything
 * else — ceiling, budget, ad set structure, targeting constants, catalogue —
 * is lifted from the source rather than asked for again.
 *
 * Two things are deliberately NOT copied:
 *   - geo, which is replaced by the target city (copying it would produce the
 *     self-competition the geo audit exists to catch);
 *   - the product set, which is re-resolved per city from the catalogue, since
 *     a Nashik product set in a Lucknow ad set serves cars nobody can reach.
 *
 * The gates still run per city. Replication is a way to skip the typing, not a
 * way to skip the checks — a source campaign that would fail its own gates
 * today produces failing gates for every city it is copied into.
 */

import type { AdSetSettings, AttributionSetting, ResultType } from "./classify";
import { classifyAudienceSource } from "./classify";
import { buildLaunchPlan, type Gate, type LaunchAdSetKind, type LaunchPlan } from "./launch";
import { lookupCity } from "../../../scripts/india-cities";
import { cityFilterRule } from "../../../scripts/real-catalogue-data";

export interface ReplicationSource {
  campaignId: string;
  name: string;
  /** Cities the source currently runs in, for display only. */
  cities: string[];
  dailyBudget: number;
  /** The source's own ceiling, carried across unless the operator changes it. */
  targetCpl: number;
  catalogueId: string | null;
  catalogueName: string | null;
  resultType: ResultType;
  attributionSetting: AttributionSetting;
  /** One entry per ad set on the source, with its audience shape. */
  adSets: {
    adSetId: string;
    name: string;
    kind: LaunchAdSetKind;
    dailyBudget: number;
    ageMin: number;
    ageMax: number;
    genders: number[];
    advantageAudience: boolean;
    interests: string[];
    lookalikeSource: string | null;
  }[];
  /** Why this campaign may be a poor thing to copy. Empty when it is fine. */
  cautions: string[];
}

/**
 * Turn a campaign and its ad sets into a replication source.
 * Ad set kind is derived from settings, never from the ad set's name.
 */
export function describeSource(
  campaign: {
    campaignId: string;
    name: string;
    cities: string[];
    dailyBudget: number;
    targetCpl: number;
    resultType: ResultType;
    attributionSetting: AttributionSetting;
    spend: number;
    leads: number;
  },
  adSets: AdSetSettings[]
): ReplicationSource {
  const mapped = adSets.map((a) => {
    const source = classifyAudienceSource(a);
    const kind: LaunchAdSetKind =
      source === "REMARKETING" ? "REMARKETING" : source === "LOOKALIKE" ? "LOOKALIKE" : "BROAD";
    return {
      adSetId: a.adSetId,
      name: a.name,
      kind,
      dailyBudget: 0,
      ageMin: a.ageMin,
      ageMax: a.ageMax,
      genders: a.genders,
      advantageAudience: a.advantageAudience,
      interests: a.interests,
      lookalikeSource: a.lookalikeSource,
    };
  });

  const cautions: string[] = [];
  if (adSets.length === 0) cautions.push("This campaign has no ad sets, so there is nothing to copy.");
  if (campaign.spend > 0 && campaign.leads === 0) {
    cautions.push("The source has spend but no results — copying it copies whatever is not working.");
  }
  if (campaign.leads > 0 && campaign.targetCpl > 0) {
    const cpl = campaign.spend / campaign.leads;
    if (cpl > campaign.targetCpl * 1.2) {
      cautions.push(
        `The source runs at ₹${Math.round(cpl)} against its ₹${Math.round(campaign.targetCpl)} ceiling. Replicating spreads that, rather than fixing it.`
      );
    }
  }
  const ages = new Set(adSets.map((a) => a.ageMin));
  const genders = new Set(adSets.map((a) => JSON.stringify(a.genders)));
  const attributions = new Set(adSets.map((a) => a.attributionSetting));
  if (ages.size > 1 || genders.size > 1 || attributions.size > 1) {
    cautions.push(
      "The source's ad sets differ on age, gender or attribution, so its own results are not readable. Copying it copies that ambiguity into every new city."
    );
  }
  if (adSets.some((a) => a.customAudiences.length > 0)) {
    cautions.push(
      "One or more ad sets use a city-specific remarketing audience. A new city has none, so those are replaced with the city's own — which will be empty for weeks."
    );
  }

  return {
    campaignId: campaign.campaignId,
    name: campaign.name,
    cities: campaign.cities,
    dailyBudget: campaign.dailyBudget,
    targetCpl: campaign.targetCpl,
    catalogueId: adSets.find((a) => a.catalogueId)?.catalogueId ?? null,
    catalogueName: adSets.find((a) => a.catalogueName)?.catalogueName ?? null,
    resultType: campaign.resultType,
    attributionSetting: campaign.attributionSetting,
    adSets: mapped,
    cautions,
  };
}

export interface ReplicationTarget {
  cityName: string;
  /** Filled from the city lookup; null means the operator must supply it. */
  state: string | null;
  tier: string;
  /** Resolved from the catalogue by city, or null when none exists yet. */
  productSet: {
    productSetId: string;
    name: string;
    productCount: number;
    filterRule: string;
    cityKey: string | null;
  } | null;
  /** The filter rule a product set for this city would need. */
  expectedFilterRule: string;
  /** True when this city is already in the platform. */
  alreadyExists: boolean;
  /**
   * What distinguishes this campaign from the one already running in the city —
   * a dealer name, a test arm, whatever the operator types. Appended to the
   * campaign name. Empty for a city being launched for the first time.
   */
  label: string | null;
  plan: LaunchPlan;
}

/**
 * The campaign name Meta will see.
 *
 * A second campaign in a city is a legitimate thing to want — a different
 * dealer, a creative test — but two campaigns called
 * `UC | META | LEAD | GURGAON | CATALOGUE | LAUNCH` are indistinguishable in
 * Ads Manager, and pausing the wrong one is then a coin flip. The label is what
 * keeps them apart, which is why a repeat city cannot launch without one.
 */
export function replicaCampaignName(cityName: string, label?: string | null): string {
  const base = `UC | META | LEAD | ${cityName.toUpperCase()} | CATALOGUE | LAUNCH`;
  const suffix = label?.trim();
  return suffix ? `${base} | ${suffix.toUpperCase()}` : base;
}

export interface ReplicationPlan {
  source: ReplicationSource;
  targets: ReplicationTarget[];
  /** Cities that can actually be launched right now. */
  launchable: ReplicationTarget[];
  blocked: ReplicationTarget[];
  totalDailyBudget: number;
}

export interface BuildReplicationInput {
  source: ReplicationSource;
  cityNames: string[];
  /** Per-city budget. Defaults to the source's daily budget. */
  dailyBudget: number;
  cplCeiling: number;
  pixelVerified: boolean;
  existingCityNames: string[];
  existingAdSets: AdSetSettings[];
  catalogue: { catalogueId: string; catalogueName: string; vertical: string; inUse: boolean } | null;
  productSets: {
    productSetId: string;
    catalogueId: string;
    name: string;
    productCount: number;
    filterRule: string;
    cityKey: string | null;
  }[];
  /** States the operator typed for cities the lookup does not know. */
  manualStates?: Record<string, string>;
  /**
   * Product sets the operator has just created in Commerce Manager, keyed by
   * lowercased city name. Without this, replicating into any city that has no
   * set yet is a guaranteed dead end — which is every genuinely new city.
   */
  manualProductSets?: Record<string, { productSetId: string; name: string; productCount: number }>;
  /**
   * Distinguishing labels, keyed by lowercased city name. Required only for a
   * city that already has a campaign.
   */
  labels?: Record<string, string>;
}

export function buildReplicationPlan(input: BuildReplicationInput): ReplicationPlan {
  const kinds = [...new Set(input.source.adSets.map((a) => a.kind))];
  const existing = new Set(input.existingCityNames.map((c) => c.trim().toLowerCase()));

  const targets: ReplicationTarget[] = input.cityNames
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((cityName) => {
      const known = lookupCity(cityName);
      const manual = input.manualStates?.[cityName.toLowerCase()]?.trim();
      const state = known?.state ?? (manual || null);

      // Re-resolve the product set for THIS city rather than copying the
      // source's. This is the whole reason replication is safe to offer.
      const manualSet = input.manualProductSets?.[cityName.toLowerCase()];
      const productSet =
        input.productSets.find(
          (p) =>
            p.catalogueId === (input.catalogue?.catalogueId ?? "") &&
            p.cityKey?.toLowerCase() === cityName.toLowerCase()
        ) ??
        // The ID is the only part that identifies anything. Requiring a name
        // as well meant a correctly pasted product set still read as "no
        // product set" — a rule that only ever cost the operator time.
        (manualSet && manualSet.productSetId.trim()
          ? {
              productSetId: manualSet.productSetId.trim(),
              catalogueId: input.catalogue?.catalogueId ?? "",
              name: manualSet.name.trim() || `${cityName} Catalogue`,
              productCount: Number(manualSet.productCount) || 0,
              filterRule: cityFilterRule(cityName),
              cityKey: cityName.toLowerCase(),
            }
          : null);

      const plan = buildLaunchPlan({
        cityName,
        cplCeiling: input.cplCeiling,
        dailyBudget: input.dailyBudget,
        adSetKinds: kinds,
        pixelVerified: input.pixelVerified,
        catalogue: input.catalogue,
        productSet,
        existingAdSets: input.existingAdSets,
        targetGeo: { cities: [cityName], regions: [] },
      });

      // A city with no state cannot be created, so it is a block of its own.
      const gates: Gate[] = state
        ? [...plan.gates]
        : [
            ...plan.gates,
            {
              id: "state",
              title: "State",
              status: "BLOCK" as const,
              detail: `${cityName} is not in the city list, so its state is unknown.`,
              remedy: "Type the state for this city, or correct the spelling.",
            },
          ];

      // Running a second campaign in a live city is allowed — a different
      // dealer, a creative test — but not anonymously. Two campaigns with the
      // same name and the same targeting are indistinguishable in Ads Manager
      // AND compete against each other in the auction, so the operator is asked
      // for a label and warned about the overlap. This used to be a flat
      // refusal, which is why a legitimate second dealer had nowhere to go.
      const alreadyExists = existing.has(cityName.toLowerCase());
      const label = input.labels?.[cityName.toLowerCase()]?.trim() || null;
      if (alreadyExists) {
        gates.push(
          label
            ? {
                id: "duplicate-city",
                title: "Second campaign in this city",
                status: "WARN" as const,
                detail: `${cityName} already has a campaign. This one will be named "${replicaCampaignName(cityName, label)}".`,
                remedy: `Both target the same geo, so they bid against each other. Split the budget rather than doubling it, or narrow one of them — a dealer-specific product set is the usual way.`,
              }
            : {
                id: "duplicate-city",
                title: "Second campaign in this city",
                status: "BLOCK" as const,
                detail: `${cityName} already has a campaign, and this one would be given the identical name.`,
                remedy: "Add a label — a dealer name or a test name — so the two can be told apart in Ads Manager.",
              }
        );
      }

      const withState: LaunchPlan = {
        ...plan,
        gates,
        canLaunch: !gates.some((g) => g.status === "BLOCK"),
      };

      return {
        cityName,
        state,
        tier: known?.tier ?? "Tier 2",
        productSet,
        expectedFilterRule: cityFilterRule(cityName),
        alreadyExists,
        label,
        plan: withState,
      };
    });

  // `alreadyExists` no longer decides this on its own. A repeat city with a
  // label passes its gates like any other; a repeat city without one is blocked
  // by the gate above, which says what to do about it.
  const launchable = targets.filter((t) => t.plan.canLaunch);
  const blocked = targets.filter((t) => !t.plan.canLaunch);

  return {
    source: input.source,
    targets,
    launchable,
    blocked,
    totalDailyBudget: launchable.length * input.dailyBudget,
  };
}
