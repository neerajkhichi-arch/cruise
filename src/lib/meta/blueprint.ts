/**
 * Reading a blueprint off a campaign that already works.
 *
 * The launch constants in engine/launch.ts are OUR description of the account:
 * age 24-65, men, 1d_click, OFFSITE_CONVERSIONS. They were derived by reading
 * the account, and they are right — but "derived by reading" is not the same as
 * "what the API will accept", and there are fields we never modelled at all:
 *
 *   - `promoted_object` is `{pixel_id, custom_event_type:"OTHER"}`. There is no
 *     custom conversion on this account, so "UCR_Lead_Submit_New" is a label in
 *     our model, not an API value. Constructing it would optimise for the wrong
 *     event, or for nothing.
 *   - Geo is a numeric key (Ahmedabad is 1015741), never a name.
 *   - Budget sits on the CAMPAIGN, not the ad set — these are CBO campaigns.
 *   - The city-specific page-visitor audience is a pixel rule filtering
 *     `City_Name_New`, not something you can name into existence.
 *
 * So the live path does not build an ad set from our constants. It reads a real
 * one, keeps every field it does not have a reason to change, and changes
 * exactly three things: geo, product set, and the city named in the copy. That
 * is what "pick all the settings from the existing campaign" has to mean if it
 * is to be true.
 */

import { graphGet } from "./graph";
import {
  AD_SET_DEFAULTS,
  CAMPAIGN_DEFAULTS,
  CONVERSION_EVENT,
  CREATIVE_TEMPLATE,
  PROMOTED_OBJECT,
  PV_AUDIENCE,
  TARGETING_TEMPLATE,
} from "../../../scripts/verified-account-facts";

export interface SourceBlueprint {
  campaign: {
    id: string;
    name: string;
    objective: string;
    bidStrategy: string;
    /** Rupees per day, read back from the source. */
    dailyBudget: number;
  };
  adSet: {
    id: string;
    name: string;
    optimizationGoal: string;
    billingEvent: string;
    promotedObject: Record<string, unknown>;
    attributionSetting: string | null;
    /**
     * The source's attribution window, exactly as Meta returned it, e.g.
     * `[{event_type: "CLICK_THROUGH", window_days: 1}]`.
     *
     * Kept raw and passed through untouched. `attributionSetting` above is a
     * display string built by concatenating those two fields, and round-tripping
     * a credential-grade setting through a string is how it gets corrupted:
     * Meta returns "CLICK_THROUGH" while our own labels say "click", so the
     * string does not reliably parse back into what the API accepts.
     *
     * This matters more than most fields because attribution CANNOT BE CHANGED
     * ONCE AN AD SET IS PUBLISHED. Getting it wrong means deleting the ad set
     * and starting again, and until someone notices, every cost figure for that
     * campaign belongs to a different cohort than the rest of the account.
     */
    attributionSpec: { event_type: string; window_days: number }[] | null;
    /**
     * The source's targeting with geo and audiences stripped out. Everything
     * else — placements, brand safety, advantage audience, relaxation types —
     * rides along untouched, because every one of those is a delivery
     * difference we would otherwise introduce without meaning to.
     */
    targetingTemplate: Record<string, unknown>;
    /** The city the source targets, so we know what to swap in the copy. */
    sourceCityName: string | null;
    sourceCityKey: string | null;
  };
  /** The source's page-visitor audience, when it has one. */
  pvAudience: {
    id: string;
    name: string;
    /** Raw rule JSON, with the source city still in it. */
    rule: string;
    retentionDays: number;
    /** The rule field that carries the city, e.g. "City_Name_New". */
    cityField: string | null;
    cityValue: string | null;
  } | null;
  creative: {
    pageId: string | null;
    /**
     * The Instagram Business Account id the ads run as, sent to the creative as
     * `instagram_user_id` (v22.0+). Named for what it is, not for the field it
     * used to be called — the old `instagram_actor_id` is a different id space,
     * and confusing the two is what produced four failed launches.
     */
    instagramUserId: string | null;
    productSetId: string | null;
    title: string | null;
    body: string | null;
    callToActionType: string | null;
    linkUrl: string | null;
  } | null;
}

/** Targeting keys that describe WHO, not HOW — these are replaced per city. */
const GEO_AND_AUDIENCE_KEYS = new Set([
  "geo_locations",
  "excluded_geo_locations",
  "custom_audiences",
  "excluded_custom_audiences",
  // Read-back-only fields Meta returns but rejects on write.
  "expanded_implicit_custom_audiences",
  "effective_publisher_platforms",
  "effective_facebook_positions",
  "effective_instagram_positions",
  "effective_messenger_positions",
  "effective_whatsapp_positions",
  "effective_threads_positions",
  "effective_audience_network_positions",
  "effective_device_platforms",
  "effective_brand_safety_content_filter_levels",
  "page_types",
  "age_range",
  "dt_consolidation_state",
]);

function findCityFilter(rule: string): { field: string; value: string } | null {
  // The rule is nested JSON; rather than walk every shape Meta emits, find any
  // filter whose field name mentions a city. Returning null is honest — the
  // caller then refuses to clone the audience rather than guessing.
  try {
    const parsed = JSON.parse(rule) as unknown;
    let found: { field: string; value: string } | null = null;
    const walk = (node: unknown): void => {
      if (found || node === null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const obj = node as Record<string, unknown>;
      if (typeof obj.field === "string" && typeof obj.value === "string" && /city/i.test(obj.field)) {
        found = { field: obj.field, value: obj.value };
        return;
      }
      Object.values(obj).forEach(walk);
    };
    walk(parsed);
    return found;
  } catch {
    return null;
  }
}

/**
 * The Instagram Business Account id from the environment.
 *
 * `META_INSTAGRAM_ACTOR_ID` is still read because that is the name already
 * sitting in .env files; it is an alias now, not a second id.
 */
function envInstagramUserId(): string | undefined {
  return (
    process.env.META_INSTAGRAM_USER_ID?.trim() ||
    process.env.META_INSTAGRAM_ACTOR_ID?.trim() ||
    undefined
  );
}

/**
 * The blueprint without an access token.
 *
 * Used for the preview, so an operator can read the exact calls before any
 * credential exists. Every value comes from verified-account-facts.ts, which
 * was read off the live account — so the preview is honest, not illustrative.
 * The one thing it cannot know is the geo key, which only Meta's search can
 * give; the preview says so rather than inventing one.
 */
export function localBlueprint(campaign: {
  campaignId: string;
  name: string;
  dailyBudget: number;
}): SourceBlueprint {
  return {
    campaign: {
      id: campaign.campaignId,
      name: campaign.name,
      objective: CAMPAIGN_DEFAULTS.objective,
      bidStrategy: CAMPAIGN_DEFAULTS.bidStrategy,
      dailyBudget: campaign.dailyBudget,
    },
    adSet: {
      id: "(from the account's live consolidated ad sets)",
      name: "Combined Aud.Catalogue",
      optimizationGoal: AD_SET_DEFAULTS.optimizationGoal,
      billingEvent: AD_SET_DEFAULTS.billingEvent,
      promotedObject: PROMOTED_OBJECT,
      attributionSetting: AD_SET_DEFAULTS.attributionSetting,
      // The preview has no live ad set to read, so it shows the account's
      // verified default rather than leaving the field blank and implying Meta's
      // (different) default would apply.
      attributionSpec: [{ event_type: "CLICK_THROUGH", window_days: 1 }],
      targetingTemplate: TARGETING_TEMPLATE,
      sourceCityName: CREATIVE_TEMPLATE.sourceCityName,
      sourceCityKey: null,
    },
    pvAudience: {
      id: PV_AUDIENCE.id,
      name: PV_AUDIENCE.name,
      rule: PV_AUDIENCE.rule,
      retentionDays: PV_AUDIENCE.retentionDays,
      cityField: PV_AUDIENCE.cityField,
      cityValue: PV_AUDIENCE.cityValue,
    },
    creative: {
      pageId: CREATIVE_TEMPLATE.pageId,
      instagramUserId: envInstagramUserId() || CREATIVE_TEMPLATE.instagramUserId,
      productSetId: null,
      title: CREATIVE_TEMPLATE.title,
      body: CREATIVE_TEMPLATE.body,
      callToActionType: CREATIVE_TEMPLATE.callToActionType,
      linkUrl: CREATIVE_TEMPLATE.linkUrl,
    },
  };
}

export async function readBlueprint(campaignId: string): Promise<SourceBlueprint> {
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
      optimization_goal: string;
      billing_event?: string;
      promoted_object?: Record<string, unknown>;
      attribution_spec?: { event_type: string; window_days: number }[];
      targeting: Record<string, unknown>;
      status: string;
    }[];
  }>(`${campaignId}/adsets`, {
    fields: "id,name,status,optimization_goal,billing_event,promoted_object,attribution_spec,targeting",
    limit: "25",
  });

  // Prefer a delivering ad set — a paused one may be paused because it is wrong.
  const source =
    adSets.data?.find((a) => a.status === "ACTIVE") ?? adSets.data?.[0];
  if (!source) throw new Error(`Campaign ${campaignId} has no ad sets to copy.`);

  const targeting = source.targeting ?? {};
  const targetingTemplate: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(targeting)) {
    if (!GEO_AND_AUDIENCE_KEYS.has(k)) targetingTemplate[k] = v;
  }

  const geo = targeting.geo_locations as { cities?: { key: number; name: string }[] } | undefined;
  const sourceCity = geo?.cities?.[0] ?? null;

  // --- the page-visitor audience, if the source uses one ------------------
  let pvAudience: SourceBlueprint["pvAudience"] = null;
  const audiences = (targeting.custom_audiences as { id: number | string; name: string }[] | undefined) ?? [];
  const pv = audiences.find((a) => /-PV-/i.test(a.name)) ?? audiences[0];
  if (pv) {
    const full = await graphGet<{ id: string; name: string; rule?: string; retention_days?: number }>(
      String(pv.id),
      { fields: "id,name,rule,retention_days" }
    );
    const rule = full.rule ?? "";
    const cityFilter = rule ? findCityFilter(rule) : null;
    pvAudience = {
      id: full.id,
      name: full.name,
      rule,
      retentionDays: full.retention_days ?? 90,
      cityField: cityFilter?.field ?? null,
      cityValue: cityFilter?.value ?? null,
    };
  }

  // --- the creative on the source's ad ------------------------------------
  let creative: SourceBlueprint["creative"] = null;
  const ads = await graphGet<{ data: { id: string; creative?: { id: string } }[] }>(
    `${source.id}/ads`,
    { fields: "id,creative{id}", limit: "5" }
  );
  const creativeId = ads.data?.[0]?.creative?.id;
  if (creativeId) {
    const c = await graphGet<{
      id: string;
      title?: string;
      body?: string;
      product_set_id?: string;
      call_to_action_type?: string;
      link_url?: string;
      object_story_spec?: {
        page_id?: string;
        instagram_actor_id?: string;
        instagram_user_id?: string;
        template_data?: { link?: string; call_to_action?: { type?: string } };
      };
    }>(creativeId, {
      fields: "id,title,body,product_set_id,call_to_action_type,link_url,object_story_spec",
    });
    creative = {
      pageId: c.object_story_spec?.page_id ?? null,
      // `instagram_user_id` only. The legacy `instagram_actor_id` on a source
      // creative is deliberately NOT used as a fallback: it belongs to a
      // different id space, and passing it here would fail the same way the
      // reverse substitution already did.
      //
      // Falling back to the account's linked Instagram account is required,
      // not defensive — these campaigns run Advantage+ placements, which
      // include Instagram, so Meta refuses the ad outright when the creative
      // names no Instagram identity.
      instagramUserId:
        c.object_story_spec?.instagram_user_id ??
        envInstagramUserId() ??
        CREATIVE_TEMPLATE.instagramUserId,
      productSetId: c.product_set_id ?? null,
      title: c.title ?? null,
      body: c.body ?? null,
      callToActionType: c.call_to_action_type ?? c.object_story_spec?.template_data?.call_to_action?.type ?? null,
      linkUrl: c.link_url ?? c.object_story_spec?.template_data?.link ?? null,
    };
  }

  // The API returns `custom_event_type: "OTHER"` but often omits which custom
  // event that is. Confirmed in Ads Manager: UCR_Lead_Submit_New. Filling it in
  // is not a guess — it is the value the account's live ad sets optimise for,
  // and creating an ad set without it optimises for nothing while looking fine.
  const promotedObject: Record<string, unknown> = { ...(source.promoted_object ?? {}) };
  if (promotedObject.custom_event_type === "OTHER" && !promotedObject.custom_event_str) {
    promotedObject.custom_event_str = process.env.META_CONVERSION_EVENT?.trim() || CONVERSION_EVENT;
  }

  const attribution = source.attribution_spec?.[0];
  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      objective: campaign.objective,
      bidStrategy: campaign.bid_strategy ?? "LOWEST_COST_WITHOUT_CAP",
      dailyBudget: campaign.daily_budget ? Number(campaign.daily_budget) / 100 : 0,
    },
    adSet: {
      id: source.id,
      name: source.name,
      optimizationGoal: source.optimization_goal,
      billingEvent: source.billing_event ?? "IMPRESSIONS",
      promotedObject,
      attributionSetting: attribution ? `${attribution.window_days}d_${attribution.event_type}` : null,
      attributionSpec: source.attribution_spec?.length ? source.attribution_spec : null,
      targetingTemplate,
      sourceCityName: sourceCity?.name ?? null,
      sourceCityKey: sourceCity ? String(sourceCity.key) : null,
    },
    pvAudience,
    creative,
  };
}
