/**
 * Adding a list of cities to Meta, either as a new campaign or into a running
 * one.
 *
 * This is the NON-CATALOGUE path. The catalogue launcher needs a product set
 * per city, which is what forces its per-city structure; a campaign whose ad is
 * an ordinary link ad has no such constraint, so a single ad set can carry as
 * many cities as the file lists.
 *
 * ---------------------------------------------------------------------------
 * THE CREATIVE IS REUSED, NOT REBUILT
 *
 * A new campaign here points its ad at the SOURCE campaign's existing creative
 * id. Rebuilding a creative means reconstructing `object_story_spec` field by
 * field — image hashes, link data, call-to-action, page and Instagram identity —
 * and every field reconstructed wrongly is an ad that either fails to create or,
 * worse, creates and looks subtly different from the one it was copied from.
 * Meta lets an ad reference a creative that already exists, so it does.
 *
 * The cost is stated rather than hidden: if that creative's copy names a city,
 * it will still name that city. The preview shows the actual body text so the
 * decision is made with eyes open.
 * ---------------------------------------------------------------------------
 */

import { actPath, graphGet, graphPost } from "./graph";
import { TTL, cached } from "./cache";
import { resolveCityGeo } from "./geo";
import { translateObjective } from "./objectives";
import { completeTargeting } from "./targeting";
import { readTargetLocations } from "./city-leads";
import { getAllAdSets } from "./adsets";
import type { CityRow } from "../csv/city-list";

export interface ResolvedCity extends CityRow {
  /** Meta's numeric key, when the name resolved to exactly one place. */
  geoKey: string | null;
  /** Meta's own name — may differ from the file's (Gurgaon → Gurugram). */
  metaName: string | null;
  region: string | null;
  /** Why it could not be resolved, when it could not. */
  problem: string | null;
  /** Worth showing even on success, e.g. resolution via an official rename. */
  note: string | null;
  /** True when this city is already targeted by the chosen ad set. */
  alreadyTargeted: boolean;
}

/**
 * Resolve every city in the list, sequentially.
 *
 * Deliberately NOT in parallel. Each city is one Meta geo search, and this
 * account is rate-limited as a whole — firing thirty searches at once is how a
 * reporting screen ends up blocking a publish. A thirty-city file taking a few
 * seconds is the right trade.
 */
export async function resolveCityList(
  cities: CityRow[],
  alreadyTargetedNames: string[] = []
): Promise<ResolvedCity[]> {
  const already = new Set(alreadyTargetedNames.map((n) => n.trim().toLowerCase()));
  const out: ResolvedCity[] = [];

  for (const c of cities) {
    const key = `geo:${c.cityName.toLowerCase()}:${(c.state ?? "").toLowerCase()}`;
    try {
      const geo = await cached(key, TTL.catalogue, () => resolveCityGeo(c.cityName, c.state));
      if (geo.ok) {
        out.push({
          ...c,
          geoKey: geo.key,
          metaName: geo.name,
          region: geo.region || null,
          problem: null,
          note: geo.note,
          alreadyTargeted: already.has(geo.name.trim().toLowerCase()) || already.has(c.cityName.trim().toLowerCase()),
        });
      } else {
        out.push({
          ...c,
          geoKey: null,
          metaName: null,
          region: null,
          problem: geo.reason,
          note: null,
          alreadyTargeted: false,
        });
      }
    } catch (err) {
      out.push({
        ...c,
        geoKey: null,
        metaName: null,
        region: null,
        problem: err instanceof Error ? err.message : String(err),
        note: null,
        alreadyTargeted: false,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading what can be updated
// ---------------------------------------------------------------------------

export interface AdSetSummary {
  adSetId: string;
  name: string;
  status: string;
  /** Cities this ad set already targets, by Meta's own names. */
  cities: string[];
  /** Non-city places — a region or country buy behaves differently. */
  otherPlaces: string[];
  dailyBudget: number;
}

export interface CampaignSummary {
  campaignId: string;
  name: string;
  status: string;
  objective: string;
  dailyBudget: number;
  adSets: AdSetSummary[];
  /** True when any ad in this campaign uses a catalogue product set. */
  usesCatalogue: boolean;
}

interface RawAdSet {
  id: string;
  name: string;
  status: string;
  campaign_id: string;
  daily_budget?: string;
  targeting?: Record<string, unknown>;
}

const fromMinorUnits = (v?: string) => (v ? Number(v) / 100 : 0);

async function pageAll<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  let pages = 0;
  do {
    pages += 1;
    const page = await graphGet<{ data: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(path, {
      ...params,
      ...(after ? { after } : {}),
    });
    out.push(...(page.data ?? []));
    after = page.paging?.next ? page.paging?.cursors?.after : undefined;
  } while (after && pages < 10);
  return out;
}

/**
 * Campaigns a city list could be added to.
 *
 * Archived and deleted campaigns are excluded — this account holds 764
 * campaigns, most of them archived, and a picker listing all of them is a
 * picker nobody can use.
 */
export async function listUpdatableCampaigns(adAccountId: string): Promise<CampaignSummary[]> {
  const [campaigns, adSets] = await Promise.all([
    cached(`campaigns-live:${adAccountId}`, TTL.structure, () =>
      pageAll<{ id: string; name: string; status: string; objective: string; daily_budget?: string }>(
        actPath(adAccountId, "campaigns"),
        {
          fields: "id,name,status,objective,daily_budget",
          effective_status: JSON.stringify(["ACTIVE", "PAUSED"]),
          limit: "200",
        }
      )
    ),
    // The FOURTH sweep of /adsets, until now. It escaped the consolidation
    // because it asked for a narrower field list and filtered to active and
    // paused — but the field list is a subset of the shared one, and the filter
    // is applied below just as well. A narrower sweep of its own is still a
    // whole extra pass over the same edge, on an account that spends its days
    // rate-limited; sharing a warm read beats owning a cold one.
    getAllAdSets<RawAdSet>(adAccountId),
  ]);

  const byCampaign = new Map<string, AdSetSummary[]>();
  for (const a of adSets) {
    // What the effective_status filter used to do. Archived ad sets cannot be
    // added to and would only lengthen a picker nobody can already use.
    if (a.status !== "ACTIVE" && a.status !== "PAUSED") continue;
    const geo = (a.targeting as { geo_locations?: Parameters<typeof readTargetLocations>[0] } | undefined)
      ?.geo_locations;
    const places = readTargetLocations(geo);
    const summary: AdSetSummary = {
      adSetId: a.id,
      name: a.name,
      status: a.status,
      cities: places.filter((p) => p.type === "city").map((p) => p.name),
      otherPlaces: places.filter((p) => p.type !== "city").map((p) => `${p.name} (${p.type})`),
      dailyBudget: fromMinorUnits(a.daily_budget),
    };
    const list = byCampaign.get(a.campaign_id) ?? [];
    list.push(summary);
    byCampaign.set(a.campaign_id, list);
  }

  return campaigns
    .map((c) => ({
      campaignId: c.id,
      name: c.name,
      status: c.status,
      objective: c.objective,
      dailyBudget: fromMinorUnits(c.daily_budget),
      adSets: byCampaign.get(c.id) ?? [],
      usesCatalogue: false,
    }))
    .filter((c) => c.adSets.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

export interface UpdateResult {
  adSetId: string;
  adSetName: string;
  before: string[];
  after: string[];
  added: string[];
  skipped: string[];
  ok: boolean;
  error: string | null;
}

/**
 * Add cities to a running ad set's geo targeting.
 *
 * Read-modify-write on the WHOLE targeting object, because Meta replaces
 * `targeting` wholesale rather than merging: sending only `geo_locations` would
 * silently drop age, gender, placements and every audience on the ad set. The
 * existing targeting is therefore read immediately before the write, not taken
 * from a list fetched minutes ago.
 *
 * Existing cities are kept. This ADDS; it never removes, because a request to
 * add three cities should not be able to un-target twelve.
 */
export async function addCitiesToAdSet(
  adSetId: string,
  cities: { cityName: string; geoKey: string }[]
): Promise<UpdateResult> {
  const live = await graphGet<{ id: string; name: string; targeting?: Record<string, unknown> }>(adSetId, {
    fields: "id,name,targeting",
  });

  const targeting: Record<string, unknown> = { ...(live.targeting ?? {}) };
  const geo = { ...((targeting.geo_locations as Record<string, unknown>) ?? {}) };
  const existing = (geo.cities as { key: string | number; name?: string }[] | undefined) ?? [];
  const existingKeys = new Set(existing.map((c) => String(c.key)));

  const added: string[] = [];
  const skipped: string[] = [];
  const nextCities = [...existing];
  for (const c of cities) {
    if (existingKeys.has(String(c.geoKey))) {
      skipped.push(c.cityName);
      continue;
    }
    nextCities.push({ key: c.geoKey, radius: 0, distance_unit: "mile" } as never);
    existingKeys.add(String(c.geoKey));
    added.push(c.cityName);
  }

  const before = existing.map((c) => c.name ?? String(c.key));

  if (added.length === 0) {
    return {
      adSetId,
      adSetName: live.name,
      before,
      after: before,
      added: [],
      skipped,
      ok: true,
      error: null,
    };
  }

  geo.cities = nextCities;
  // Meta rejects the read-back-only `effective_*` keys on write; they describe
  // what delivery resolved to, not what was asked for.
  targeting.geo_locations = geo;
  for (const k of Object.keys(targeting)) {
    if (k.startsWith("effective_") || k === "expanded_implicit_custom_audiences" || k === "page_types") {
      delete targeting[k];
    }
  }

  // An update to a live ad set is validated like a create, so the same
  // Advantage audience flag has to be present. Copied when the ad set already
  // has one — this must never flip an existing ad set's setting.
  const ready = completeTargeting(targeting).targeting;

  try {
    await graphPost(adSetId, { targeting: ready });
    return {
      adSetId,
      adSetName: live.name,
      before,
      after: [...before, ...added],
      added,
      skipped,
      ok: true,
      error: null,
    };
  } catch (err) {
    return {
      adSetId,
      adSetName: live.name,
      before,
      after: before,
      added: [],
      skipped,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Creating a new campaign from a source
// ---------------------------------------------------------------------------

export interface SourceSummary {
  campaignId: string;
  campaignName: string;
  objective: string;
  bidStrategy: string;
  dailyBudget: number;
  adSetId: string;
  adSetName: string;
  optimizationGoal: string;
  billingEvent: string;
  promotedObject: Record<string, unknown> | null;
  attributionSpec: { event_type: string; window_days: number }[] | null;
  targetingTemplate: Record<string, unknown>;
  creativeId: string | null;
  /** Shown in the preview so a city named in the ad copy is visible up front. */
  creativeName: string | null;
  creativeBody: string | null;
  creativeLink: string | null;
  /** True when the source's ad is a catalogue ad — wrong module for that. */
  usesCatalogue: boolean;
}

/** Targeting keys that are the source's own audience, or are read-back-only. */
const DROP_FROM_TARGETING = new Set([
  "geo_locations",
  "excluded_geo_locations",
  "custom_audiences",
  "excluded_custom_audiences",
  "expanded_implicit_custom_audiences",
  "page_types",
  "age_range",
  "dt_consolidation_state",
]);

export async function readSource(campaignId: string): Promise<SourceSummary> {
  const campaign = await graphGet<{
    id: string;
    name: string;
    objective: string;
    bid_strategy?: string;
    daily_budget?: string;
  }>(campaignId, { fields: "id,name,objective,bid_strategy,daily_budget" });

  const adSets = await graphGet<{
    data: {
      id: string;
      name: string;
      status: string;
      optimization_goal: string;
      billing_event?: string;
      promoted_object?: Record<string, unknown>;
      attribution_spec?: { event_type: string; window_days: number }[];
      targeting?: Record<string, unknown>;
    }[];
  }>(`${campaignId}/adsets`, {
    fields: "id,name,status,optimization_goal,billing_event,promoted_object,attribution_spec,targeting",
    limit: "25",
  });

  // Prefer a delivering ad set — a paused one may be paused because it is wrong.
  const source = adSets.data?.find((a) => a.status === "ACTIVE") ?? adSets.data?.[0];
  if (!source) throw new Error(`${campaign.name} has no ad set to copy.`);

  const targetingTemplate: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source.targeting ?? {})) {
    if (!DROP_FROM_TARGETING.has(k) && !k.startsWith("effective_")) targetingTemplate[k] = v;
  }

  const ads = await graphGet<{ data: { id: string; creative?: { id: string } }[] }>(`${source.id}/ads`, {
    fields: "id,creative{id}",
    limit: "5",
  });
  const creativeId = ads.data?.[0]?.creative?.id ?? null;

  let creativeName: string | null = null;
  let creativeBody: string | null = null;
  let creativeLink: string | null = null;
  let usesCatalogue = false;
  if (creativeId) {
    const c = await graphGet<{
      id: string;
      name?: string;
      body?: string;
      product_set_id?: string;
      object_story_spec?: {
        link_data?: { message?: string; link?: string };
        template_data?: { message?: string; link?: string };
      };
    }>(creativeId, { fields: "id,name,body,product_set_id,object_story_spec" });
    creativeName = c.name ?? null;
    creativeBody = c.body ?? c.object_story_spec?.link_data?.message ?? c.object_story_spec?.template_data?.message ?? null;
    creativeLink = c.object_story_spec?.link_data?.link ?? c.object_story_spec?.template_data?.link ?? null;
    usesCatalogue = Boolean(c.product_set_id);
  }

  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    objective: campaign.objective,
    bidStrategy: campaign.bid_strategy ?? "LOWEST_COST_WITHOUT_CAP",
    dailyBudget: fromMinorUnits(campaign.daily_budget),
    adSetId: source.id,
    adSetName: source.name,
    optimizationGoal: source.optimization_goal,
    billingEvent: source.billing_event ?? "IMPRESSIONS",
    promotedObject: source.promoted_object ?? null,
    attributionSpec: source.attribution_spec?.length ? source.attribution_spec : null,
    targetingTemplate,
    creativeId,
    creativeName,
    creativeBody,
    creativeLink,
    usesCatalogue,
  };
}

export interface CreateResult {
  ok: boolean;
  campaignId: string | null;
  campaignName: string;
  adSetId: string | null;
  adId: string | null;
  cities: string[];
  error: string | null;
  rolledBack: string[];
  notes: string[];
}

export async function createCityCampaign(
  adAccountId: string,
  source: SourceSummary,
  campaignName: string,
  cities: { cityName: string; geoKey: string }[],
  opts: { dailyBudget: number; activate: boolean }
): Promise<CreateResult> {
  const notes: string[] = [];
  const undo: string[] = [];
  const out: CreateResult = {
    ok: false,
    campaignId: null,
    campaignName,
    adSetId: null,
    adId: null,
    cities: cities.map((c) => c.cityName),
    error: null,
    rolledBack: [],
    notes,
  };

  if (cities.length === 0) {
    out.error = "No resolved city to target.";
    return out;
  }
  if (!source.attributionSpec) {
    // Same refusal as the catalogue launcher: omitting attribution does not
    // inherit the source's, it applies Meta's 7-day-click default, and it
    // cannot be changed after the ad set exists.
    out.error =
      "The source ad set reports no attribution window. Creating without it would silently use Meta's 7-day-click default, which cannot be changed afterwards and would make this campaign's cost per lead incomparable with the rest of the account.";
    return out;
  }

  // Meta still reports pre-ODAX objectives on old campaigns but refuses to
  // create with them, so the source's objective cannot simply be copied.
  const objective = translateObjective(source.objective, source.promotedObject);
  if (!objective.objective) {
    out.error = objective.note ?? `Cannot map the source objective "${source.objective}".`;
    return out;
  }
  if (objective.note) notes.push(objective.note);

  // Meta now requires the Advantage audience flag on any new ad set, and older
  // sources do not carry it. Filled in before anything is created, so the
  // campaign is not left behind by an ad set that fails validation.
  const builtTargeting = completeTargeting({
    ...source.targetingTemplate,
    geo_locations: {
      cities: cities.map((c) => ({ key: c.geoKey, radius: 0, distance_unit: "mile" })),
      location_types: ["home", "recent"],
    },
  });
  const adSetTargeting = builtTargeting.targeting;
  if (builtTargeting.note) notes.push(builtTargeting.note);

  const rollback = async () => {
    for (const id of undo.reverse()) {
      try {
        await graphPost(id, { status: "DELETED" });
        out.rolledBack.push(id);
      } catch {
        out.rolledBack.push(`FAILED TO REMOVE ${id} — delete it by hand in Ads Manager`);
      }
    }
  };

  try {
    const campaign = await graphPost<{ id: string }>(actPath(adAccountId, "campaigns"), {
      name: campaignName,
      objective: objective.objective,
      status: opts.activate ? "ACTIVE" : "PAUSED",
      special_ad_categories: [],
      bid_strategy: source.bidStrategy,
      daily_budget: Math.round(opts.dailyBudget * 100),
    });
    out.campaignId = campaign.id;
    undo.push(campaign.id);

    const adSet = await graphPost<{ id: string }>(actPath(adAccountId, "adsets"), {
      name: `${campaignName} · ${cities.length} ${cities.length === 1 ? "city" : "cities"}`,
      campaign_id: campaign.id,
      status: opts.activate ? "ACTIVE" : "PAUSED",
      optimization_goal: source.optimizationGoal,
      billing_event: source.billingEvent,
      ...(source.promotedObject ? { promoted_object: source.promotedObject } : {}),
      attribution_spec: source.attributionSpec,
      targeting: adSetTargeting,
    });
    out.adSetId = adSet.id;
    undo.push(adSet.id);

    if (source.creativeId) {
      const ad = await graphPost<{ id: string }>(actPath(adAccountId, "ads"), {
        name: `${campaignName} · Ad`,
        adset_id: adSet.id,
        creative: { creative_id: source.creativeId },
        status: opts.activate ? "ACTIVE" : "PAUSED",
      });
      out.adId = ad.id;
      notes.push(
        `The ad reuses the source's existing creative (${source.creativeId}) rather than rebuilding it. Its copy is unchanged, so anything it names — including a city — still applies.`
      );
    } else {
      notes.push(
        "The source campaign has no readable ad, so the campaign and ad set were created without one. Add an ad in Ads Manager before switching it on."
      );
    }

    out.ok = true;
    return out;
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
    await rollback();
    return out;
  }
}
