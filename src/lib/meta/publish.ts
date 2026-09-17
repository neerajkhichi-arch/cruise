/**
 * Turning a launch into Graph API calls, and running them.
 *
 * One builder serves both modes. A dry run returns the call list; a live run
 * executes that same list. There is deliberately no second code path, because
 * a dry run that prints something other than what the live run sends is worse
 * than no dry run at all.
 *
 * Calls are ordered so that each depends only on ids produced before it, and
 * placeholders (`{{campaign_id}}`) are substituted as the run proceeds. On a
 * failure the executor deletes what it has already created, in reverse. A
 * half-built campaign in Ads Manager — a campaign and ad set with no ad, still
 * ACTIVE — is the worst outcome available, and it is the default one if you
 * do not write the rollback.
 */

import { actPath, graphDelete, graphPost, GraphError, type GraphCall, type GraphCallResult } from "./graph";
import type { SourceBlueprint } from "./blueprint";
import { replicaCampaignName } from "../engine/replicate";
import { translateObjective } from "./objectives";
import { completeTargeting } from "./targeting";

export interface PublishTarget {
  cityName: string;
  /** Meta's numeric city key, resolved before this point. */
  geoKey: string;
  productSetId: string;
  productCount: number;
  /** Rupees per day, at the campaign (CBO) level. */
  dailyBudget: number;
  cplCeiling: number;
  /** Whether a page-visitor audience for this city already exists. */
  existingPvAudienceId: string | null;
  /**
   * What distinguishes this campaign from another in the same city — a dealer,
   * a test arm. Goes into the campaign, ad set and creative names, so all three
   * are identifiable in Ads Manager rather than just the campaign.
   */
  label?: string | null;
  /**
   * Further cities in a consolidated campaign, beyond `cityName`/`geoKey`.
   *
   * One ad set, several cities, one shared budget. Two consequences are real
   * and are surfaced as notes rather than buried:
   *
   *   - Meta reports ONE spend figure for the ad set, so per-city spend, leads
   *     and cost per lead cannot be recovered. This app's Cities screen will
   *     show the money as unattributed, which is the honest answer.
   *   - Auto-pause works on a city's own ad set. A consolidated ad set has no
   *     per-city object to stop, so these campaigns sit outside it entirely.
   */
  extraCities?: { cityName: string; geoKey: string }[];
  /** What the consolidated campaign is called, e.g. "North". */
  groupName?: string | null;
  /**
   * Existing Meta audiences to TARGET. Turns this into a remarketing buy, and
   * the app's own classifier will read it back as REMARKETING, because stage is
   * decided by settings rather than by the name.
   *
   * Each must be large enough to deliver; see the refusal in buildPublishPlan.
   */
  includeAudiences?: AudienceRef[];
  /**
   * Existing Meta audiences to EXCLUDE. No size floor applies: removing 50
   * people from a broad buy costs nothing and breaks nothing, so refusing a
   * small audience here would be a rule with no reason behind it.
   */
  excludeAudiences?: AudienceRef[];
}

export interface AudienceRef {
  id: string;
  name: string;
  /** Upper bound of Meta's reported size range; null when Meta reports none. */
  sizeUpper?: number | null;
  /** False when Meta says the audience cannot be used as it stands. */
  targetable?: boolean;
  /** Meta's or our own wording for why not. */
  reason?: string | null;
}

export interface PublishPlan {
  target: PublishTarget;
  calls: GraphCall[];
  /** Decisions taken while building, shown to the operator before they commit. */
  notes: string[];
  /** Reasons this cannot be published at all. */
  blockers: string[];
}

/** Where a consolidated campaign sends people, having no single city page. */
const GENERIC_USED_CARS_URL = "https://www.cardekho.com/used-cars";

const PLACEHOLDER = {
  campaign: "{{campaign_id}}",
  adSet: "{{adset_id}}",
  creative: "{{creative_id}}",
  audience: "{{audience_id}}",
} as const;

/** Meta takes budgets in minor units — paise, not rupees. */
function toMinorUnits(rupees: number): number {
  return Math.round(rupees * 100);
}

function swapCity(text: string | null, from: string | null, to: string): string | null {
  if (!text) return text;
  if (!from) return text;
  return text.replace(new RegExp(from, "gi"), to);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Point the landing page at the city the ad is for.
 *
 * The source Ahmedabad ad links to
 * `https://www.cardekho.com/used-cars+in+ahmedabad`. Replicating it into
 * Gurgaon copied that link verbatim, so a Gurgaon ad would have sent every
 * click to Ahmedabad stock. The body copy was already being rewritten — the
 * comment above it even says "otherwise Lucknow's ad advertises Mohali's
 * inventory" — and the link, which is the half that actually costs money, was
 * missed.
 *
 * The city can appear as `ahmedabad`, `new+delhi`, `new-delhi` or `new%20delhi`
 * depending on the page, so the separator is matched rather than assumed, and
 * whatever separator the source used is reused for the target.
 */
export function rewriteCityInUrl(
  url: string | null,
  from: string | null,
  to: string
): { url: string | null; changed: boolean; containedCity: boolean } {
  if (!url || !from) return { url, changed: false, containedCity: false };

  const fromWords = from.trim().split(/\s+/).map(escapeRe);
  const toWords = to.trim().split(/\s+/);
  // The separator between words of a multi-word city: +, -, _, or the
  // percent-encoded space. %20 has to be spelled out rather than covered by a
  // "non-alphanumeric" class, because the 2 and the 0 are alphanumeric — which
  // is exactly how the first version of this silently left "new%20delhi" in a
  // Gurgaon ad's URL.
  const SEP = "((?:%20|[^a-zA-Z0-9]){0,3})";
  const pattern = new RegExp(fromWords.join(SEP), "gi");

  if (!pattern.test(url)) return { url, changed: false, containedCity: false };
  pattern.lastIndex = 0;

  const next = url.replace(pattern, (...args) => {
    // Reuse the separator the source URL used, so the shape of the link is kept.
    const separators = args.slice(1, fromWords.length) as (string | undefined)[];
    const sep = separators.find((s) => s) ?? "+";
    return toWords.join(sep).toLowerCase();
  });

  return { url: next, changed: next !== url, containedCity: true };
}

export function buildPublishPlan(
  adAccountId: string,
  blueprint: SourceBlueprint,
  target: PublishTarget,
  opts: { activate: boolean; mode: "DRY_RUN" | "LIVE" }
): PublishPlan {
  const calls: GraphCall[] = [];
  const notes: string[] = [];
  const blockers: string[] = [];
  let step = 0;
  const add = (
    label: string,
    path: string,
    payload: Record<string, unknown>,
    optional = false
  ) => {
    calls.push({ step: ++step, label, method: "POST", path, payload, optional });
  };

  // A preview is allowed to be incomplete; a live run is not. Anything the
  // preview cannot know is shown as a placeholder and named in the notes,
  // rather than being quietly filled with something plausible.
  const geoKey = target.geoKey || "<resolved from Meta's city search at publish>";

  // A consolidated campaign is one campaign, one ad set, several cities.
  const cityList = [target.cityName, ...(target.extraCities ?? []).map((c) => c.cityName)];
  const isMultiCity = cityList.length > 1;
  // What this campaign is called. A group name beats a list of five cities in
  // an Ads Manager row; the list is still shown in the notes.
  const displayName = isMultiCity ? (target.groupName?.trim() || cityList.join(" + ")) : target.cityName;

  if (isMultiCity) {
    for (const c of target.extraCities ?? []) {
      if (!c.geoKey) {
        blockers.push(
          `No Meta city key for ${c.cityName}. Every city in a consolidated campaign has to resolve before any of it is created.`
        );
      }
    }
    notes.push(
      `One ad set covering ${cityList.length} cities: ${cityList.join(", ")}. Meta reports a single spend figure for it, so per-city spend, leads and cost per lead cannot be recovered afterwards — Cities will show this money as unattributed rather than guess a split.`
    );
    notes.push(
      `Auto-pause does not apply to this campaign. It stops a city by pausing that city's own ad set, and a consolidated ad set has no per-city object to stop. Watch its budget yourself.`
    );
    notes.push(
      `All ${cityList.length} cities share one product set, so a buyer in one of them can be shown a vehicle in another. That is inherent to putting several cities in one ad, not a setting that can be turned off.`
    );
  }
  if (!target.geoKey) {
    if (opts.mode === "LIVE") {
      blockers.push(
        `No Meta city key for ${target.cityName}. Meta targets cities by numeric key, not by name, so this cannot be created until the name resolves to exactly one city.`
      );
    } else {
      notes.push(
        `Meta targets cities by numeric key, not by name. ${target.cityName}'s key is looked up at publish; if the name matches more than one Indian city the publish stops and asks which.`
      );
    }
  }
  if (!target.productSetId) {
    const msg = `No product set for ${target.cityName}. A catalogue ad draws its creative from the product feed, so there is nothing to serve without one.`;
    if (opts.mode === "LIVE") blockers.push(msg);
    else notes.push(msg + " Create it in Commerce Manager filtered on the city, then record its ID here.");
  } else if (target.productCount === 0) {
    // A product set can exist and match nothing. The campaign is then created
    // successfully, is approved, and serves an empty carousel — the failure is
    // invisible until you wonder why a live campaign has no impressions. So an
    // empty set is refused outright rather than warned about.
    blockers.push(
      `The product set for ${target.cityName} matches 0 vehicles. The campaign would be created and approved, and then serve nothing. Get the city's stock into the catalogue before launching it.`
    );
  }
  if (!blueprint.creative?.pageId) {
    blockers.push("The source ad's creative has no page, so a new ad cannot be built from it.");
  }

  // The conversion event is the one field that fails silently. An ad set with
  // custom_event_type "OTHER" and no custom_event_str is accepted by the API,
  // runs, spends, and optimises for no particular event — and reads as correct
  // everywhere you would look. So it is a refusal, not a warning.
  const promoted = blueprint.adSet.promotedObject as Record<string, unknown>;
  if (promoted.custom_event_type === "OTHER" && !promoted.custom_event_str) {
    blockers.push(
      "The source optimises for a custom pixel event, but the event name is missing. Meta accepts the ad set anyway and it optimises for nothing in particular, so this is refused rather than warned about. Set META_CONVERSION_EVENT."
    );
  } else if (promoted.custom_event_str) {
    notes.push(
      `Optimising for the custom pixel event ${String(promoted.custom_event_str)} on dataset ${String(promoted.pixel_id)} — the same event the source ad set uses.`
    );
  }

  // --- 1. the city's page-visitor audience ---------------------------------
  // The operator chose: create the audience, skip the remarketing ad set. The
  // audience starts empty and fills from today, so it is worth something in a
  // month; an ad set pointed at it today would simply not deliver.
  let audienceRef: string | null = target.existingPvAudienceId;
  if (!audienceRef && blueprint.pvAudience) {
    const { rule, cityField, cityValue, retentionDays } = blueprint.pvAudience;
    if (cityField && cityValue) {
      const newRule = rule.replace(
        new RegExp(`("${cityField}"[^}]*?"value"\\s*:\\s*")${cityValue}(")`, "i"),
        `$1${target.cityName.toLowerCase()}$2`
      );
      if (newRule === rule) {
        notes.push(
          `Could not rewrite the ${cityField} filter in the source audience rule, so no page-visitor audience was created for ${target.cityName}. Create it by hand from the Ahmedabad one.`
        );
      } else {
        // No `subtype`: the current API rejects it outright ("not supported in
        // the current API version"). A rule-based website audience is defined
        // by its rule; the subtype was removed.
        add(
          "Create page-visitor audience",
          actPath(adAccountId, "customaudiences"),
          {
            name: `CD-FB-Buy Used Car-PV-${target.cityName.toLowerCase()}-90Days-New`,
            retention_days: retentionDays,
            rule: newRule,
            prefill: true,
          },
          true // optional — the campaign does not depend on it
        );
        audienceRef = PLACEHOLDER.audience;
        notes.push(
          `Creating the 90-day page-visitor audience for ${target.cityName} now, so it starts filling today. No remarketing ad set is created — it would have nobody to deliver to. Revisit at day 30.`
        );
      }
    } else {
      notes.push(
        `The source's page-visitor audience has no readable city filter, so none was cloned for ${target.cityName}.`
      );
    }
  } else if (audienceRef) {
    notes.push(`${target.cityName} already has a page-visitor audience; reusing it rather than creating a second.`);
  }

  // --- 2. creative ---------------------------------------------------------
  // Deliberately BEFORE the campaign. The creative depends on nothing we
  // create — only on the page, the product set and the catalogue — while it
  // is also the call most likely to be rejected. Building it first means a
  // rejection costs nothing to undo; building it fourth, as this did
  // originally, meant a campaign and an ad set had to be rolled back every
  // time a creative field was wrong.
  // A label distinguishes a second campaign in a city from the first. It rides
  // through every name, not just the campaign's: an operator looking at a list
  // of ad sets should not have to open each one to work out whose it is.
  const suffix = target.label?.trim() ? ` · ${target.label.trim()}` : "";

  const c = blueprint.creative;
  const hasCreative = Boolean(c?.pageId);

  // The landing page, pointed at this city rather than the source's.
  // For a consolidated campaign there is no single city to point the link at.
  // Substituting one of them would send buyers in the other four to the wrong
  // city's listings, so the city is stripped out rather than swapped.
  const link = isMultiCity
    ? { url: GENERIC_USED_CARS_URL, changed: true, containedCity: true }
    : rewriteCityInUrl(c?.linkUrl ?? null, blueprint.adSet.sourceCityName, target.cityName);
  if (c?.linkUrl && isMultiCity) {
    notes.push(
      `Landing page set to ${GENERIC_USED_CARS_URL}. The source links to a single city's listings and there is no one city to swap in for ${cityList.length} of them.`
    );
  } else if (c?.linkUrl) {
    if (link.changed) {
      notes.push(`Landing page rewritten for ${target.cityName}: ${c.linkUrl} → ${link.url}`);
    } else if (link.containedCity) {
      // Matched the source city but produced no change — should be impossible,
      // and shipping the source city's URL is worse than not shipping.
      blockers.push(
        `The source's landing page (${c.linkUrl}) names ${blueprint.adSet.sourceCityName} and could not be rewritten for ${target.cityName}. The ad would send every click to the wrong city's stock.`
      );
    } else {
      notes.push(
        `The source's landing page (${c.linkUrl}) names no city, so it is used unchanged. Check it is right for ${target.cityName}.`
      );
    }
  }

  if (c?.pageId) {
    add("Create catalogue creative", actPath(adAccountId, "adcreatives"), {
      name: `${displayName} · Catalogue${suffix}`,
      product_set_id: target.productSetId || "<product set for this city>",
      object_story_spec: {
        page_id: c.pageId,
        // `instagram_user_id`, not `instagram_actor_id`: the latter was
        // replaced from v22.0 and wants an id space this account no longer has.
        ...(c.instagramUserId && /^\d+$/.test(c.instagramUserId)
          ? { instagram_user_id: c.instagramUserId }
          : {}),
        template_data: {
          // The source's headline is a catalogue token, so it carries across
          // untouched. The body names a city and a vehicle count, so both are
          // rewritten — otherwise Lucknow's ad advertises Mohali's inventory.
          name: c.title ?? "{{vehicle.title}} {{vehicle.price strip_zeros}}",
          message: rewriteBody(c.body, blueprint.adSet.sourceCityName, target, displayName),
          link: link.url ?? "https://www.cardekho.com/used-cars",
          call_to_action: { type: c.callToActionType ?? "GET_QUOTE" },
        },
      },
    });
  }

  // --- 3. campaign ---------------------------------------------------------
  // Budget sits here, not on the ad set: the source campaigns are CBO.
  const campaignName = replicaCampaignName(displayName, target.label);

  // Meta reports pre-ODAX objectives on older campaigns but refuses to create
  // with them, so the source's objective is translated rather than copied. A
  // change is stated, never silent.
  const objective = translateObjective(blueprint.campaign.objective, blueprint.adSet.promotedObject);
  if (!objective.objective) blockers.push(objective.note ?? "The source campaign's objective cannot be translated.");
  else if (objective.note) notes.push(objective.note);

  add("Create campaign", actPath(adAccountId, "campaigns"), {
    name: campaignName,
    objective: objective.objective || blueprint.campaign.objective,
    status: opts.activate ? "ACTIVE" : "PAUSED",
    special_ad_categories: [],
    bid_strategy: blueprint.campaign.bidStrategy,
    daily_budget: toMinorUnits(target.dailyBudget),
  });

  // --- 4. ad set -----------------------------------------------------------
  // Everything from the source except geo and audiences, which are the point.
  //
  // The blueprint strips custom_audiences out of the source's targeting on
  // purpose — the source's audiences belong to the source's city and copying
  // them would point a Gurgaon ad set at Ahmedabad's visitors. Audiences are
  // added back here only when the operator chose them explicitly.
  const include = target.includeAudiences ?? [];
  const exclude = target.excludeAudiences ?? [];

  // An audience too small to deliver is refused, the same way an empty product
  // set is: the campaign would be created, approved, and then serve nothing,
  // and the failure is invisible until someone wonders about the zero.
  for (const a of include) {
    if (a.targetable === false) {
      blockers.push(
        `The audience "${a.name}" cannot be targeted. ${a.reason ?? "Meta reports it as not ready."} An ad set built on it would be approved and then deliver nothing.`
      );
    }
  }
  if (include.length > 0 && blockers.length === 0) {
    notes.push(
      `Targeting ${include.length} existing ${include.length === 1 ? "audience" : "audiences"}: ${include
        .map((a) => a.name)
        .join(", ")}. This makes it a remarketing buy, and it will show as REMARKETING throughout this app because stage is read from settings, not from the name.`
    );
  }
  if (exclude.length > 0) {
    notes.push(
      `Excluding ${exclude.map((a) => a.name).join(", ")} — these people will not be shown this campaign. No size floor applies to an exclusion.`
    );
  }
  // Same audience on both sides means Meta targets nobody. Cheap to check, and
  // the resulting ad set looks entirely normal until you notice it never spends.
  const bothWays = include.filter((a) => exclude.some((e) => e.id === a.id));
  if (bothWays.length > 0) {
    blockers.push(
      `${bothWays.map((a) => `"${a.name}"`).join(", ")} ${bothWays.length === 1 ? "is" : "are"} set to be both targeted and excluded, which leaves the ad set with nobody to deliver to.`
    );
  }

  // Every city this ad set buys. One entry for a normal launch; several for a
  // consolidated campaign.
  const allCities = [
    { cityName: target.cityName, geoKey },
    ...(target.extraCities ?? []),
  ];

  const built = completeTargeting({
    ...blueprint.adSet.targetingTemplate,
    geo_locations: {
      cities: allCities.map((c) => ({ key: c.geoKey, radius: 0, distance_unit: "mile" })),
      location_types: ["home", "recent"],
    },
    ...(include.length > 0 ? { custom_audiences: include.map((a) => ({ id: a.id })) } : {}),
    ...(exclude.length > 0 ? { excluded_custom_audiences: exclude.map((a) => ({ id: a.id })) } : {}),
  });
  const targeting = built.targeting;
  if (built.note) notes.push(built.note);
  // Attribution is sent explicitly and is NOT optional.
  //
  // Omitting it does not mean "inherit from the source" — it means Meta applies
  // its own default of 7-day click. The first Gurgaon replica was created that
  // way while every other campaign in the account runs 1-day click, and Meta
  // will not let the setting be changed after the ad set is published. The cost
  // per lead of that campaign was therefore not comparable with any other, and
  // the only fix was to delete it.
  const attributionSpec = blueprint.adSet.attributionSpec;
  if (!attributionSpec) {
    blockers.push(
      "The source ad set reports no attribution window, so a replica would silently be created on Meta's 7-day-click default. Attribution cannot be changed after publishing and cost per lead is only comparable within one setting, so this is refused rather than guessed."
    );
  } else {
    notes.push(
      `Attribution copied from the source: ${attributionSpec
        .map((a) => `${a.window_days}-day ${a.event_type.toLowerCase().replace(/_/g, " ")}`)
        .join(", ")}. This cannot be changed once the ad set exists.`
    );
  }

  add("Create ad set", actPath(adAccountId, "adsets"), {
    name: `${displayName} · Broad${suffix}`,
    campaign_id: PLACEHOLDER.campaign,
    status: opts.activate ? "ACTIVE" : "PAUSED",
    optimization_goal: blueprint.adSet.optimizationGoal,
    billing_event: blueprint.adSet.billingEvent,
    promoted_object: blueprint.adSet.promotedObject,
    ...(attributionSpec ? { attribution_spec: attributionSpec } : {}),
    targeting,
  });

  // --- 5. ad ---------------------------------------------------------------
  if (hasCreative) {
    add("Create ad", actPath(adAccountId, "ads"), {
      name: `Catalogue-${displayName}`,
      adset_id: PLACEHOLDER.adSet,
      creative: { creative_id: PLACEHOLDER.creative },
      status: opts.activate ? "ACTIVE" : "PAUSED",
    });
  }

  if (opts.activate) {
    notes.push(
      `Everything is created ACTIVE, so delivery and spend begin as soon as review passes — up to ₹${target.dailyBudget.toLocaleString("en-IN")} a day for this city.`
    );
  }

  return { target, calls, notes, blockers };
}

/**
 * The source body reads "595+ used cars to choose from in Mohali!". Both halves
 * are wrong for a new city, and the count is the half people forget.
 */
function rewriteBody(
  body: string | null,
  sourceCity: string | null,
  target: PublishTarget,
  displayName: string
): string {
  const fallback = `${target.productCount}+ used cars to choose from in ${displayName}! 🚘`;
  if (!body) return fallback;
  let out = swapCity(body, sourceCity, displayName) ?? body;
  out = out.replace(/\d[\d,]*\s*\+/, `${target.productCount}+`);
  return out;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface PublishResult {
  cityName: string;
  mode: "DRY_RUN" | "LIVE";
  ok: boolean;
  results: GraphCallResult[];
  created: { campaignId?: string; adSetId?: string; creativeId?: string; adId?: string; audienceId?: string };
  notes: string[];
  error?: string;
  rolledBack: string[];
}

function substitute(payload: Record<string, unknown>, ids: Record<string, string>): Record<string, unknown> {
  const raw = JSON.stringify(payload);
  const filled = raw.replace(/\{\{(campaign_id|adset_id|creative_id|audience_id)\}\}/g, (m, key: string) =>
    ids[key] ?? m
  );
  return JSON.parse(filled) as Record<string, unknown>;
}

export async function executePlan(plan: PublishPlan, mode: "DRY_RUN" | "LIVE"): Promise<PublishResult> {
  const results: GraphCallResult[] = [];
  // Starts from the plan's notes and gains any skipped optional step, so the
  // result explains itself without the caller cross-referencing two lists.
  const notes: string[] = [...plan.notes];
  const ids: Record<string, string> = {};
  const created: PublishResult["created"] = {};
  const rolledBack: string[] = [];

  if (plan.blockers.length > 0) {
    return {
      cityName: plan.target.cityName,
      mode,
      ok: false,
      results: plan.calls.map((c) => ({ ...c, status: "SKIPPED", sent: false })),
      created,
      notes,
      error: plan.blockers.join(" "),
      rolledBack,
    };
  }

  if (mode === "DRY_RUN") {
    return {
      cityName: plan.target.cityName,
      mode,
      ok: true,
      results: plan.calls.map((c) => ({
        ...c,
        payload: substitute(c.payload, {
          campaign_id: "<the campaign created earlier in this run>",
          adset_id: "<the ad set created earlier in this run>",
          creative_id: "<the creative created earlier in this run>",
          audience_id: "<the audience created earlier in this run>",
        }),
        status: "OK",
        sent: false,
      })),
      created,
      notes,
      rolledBack,
    };
  }

  // --- live ---------------------------------------------------------------
  // Track what we make so a later failure can be undone.
  const undo: { path: string; label: string }[] = [];

  for (const call of plan.calls) {
    const payload = substitute(call.payload, ids);
    try {
      const res = await graphPost<{ id: string }>(call.path, payload);
      results.push({ ...call, payload, status: "OK", id: res.id, sent: true });

      if (call.path.endsWith("/campaigns")) {
        ids.campaign_id = res.id;
        created.campaignId = res.id;
      } else if (call.path.endsWith("/adsets")) {
        ids.adset_id = res.id;
        created.adSetId = res.id;
      } else if (call.path.endsWith("/adcreatives")) {
        ids.creative_id = res.id;
        created.creativeId = res.id;
      } else if (call.path.endsWith("/ads")) {
        created.adId = res.id;
      } else if (call.path.endsWith("/customaudiences")) {
        ids.audience_id = res.id;
        created.audienceId = res.id;
      }
      // The audience is deliberately NOT added to the undo list. It costs
      // nothing, harms nothing, and starts filling the moment it exists — so
      // keeping it after a failed launch is strictly better than deleting it.
      if (!call.path.endsWith("/customaudiences")) {
        undo.unshift({ path: res.id, label: call.label });
      }
    } catch (err) {
      const message = err instanceof GraphError ? err.describe() : String(err);
      results.push({ ...call, payload, status: "FAILED", error: message, sent: true });

      // An optional step failing is a note, not a rollback. Losing the
      // page-visitor audience costs a day-30 option; losing the campaign
      // because of it costs the whole launch.
      if (call.optional) {
        notes.push(`${call.label} failed and was skipped — ${message}`);
        continue;
      }

      for (const u of undo) {
        try {
          await graphDelete(u.path);
          rolledBack.push(`${u.label} (${u.path})`);
        } catch {
          rolledBack.push(`FAILED TO REMOVE ${u.label} (${u.path}) — delete it by hand in Ads Manager`);
        }
      }
      return {
        cityName: plan.target.cityName,
        mode,
        ok: false,
        results,
        created: {},
        notes,
        error: message,
        rolledBack,
      };
    }
  }

  return { cityName: plan.target.cityName, mode, ok: true, results, created, notes, rolledBack };
}
