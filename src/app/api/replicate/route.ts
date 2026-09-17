import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { adSets as adSetsTable, campaigns, campaignCities, cities } from "@/lib/db/schema";
import { newId } from "@/lib/id";
import { requireAccount, requireAccountEditor } from "@/lib/api-auth";
import { getAdSetSettings, getCampaignMetrics, getCityMetrics } from "@/lib/queries";
import { buildReplicationPlan, describeSource, replicaCampaignName } from "@/lib/engine/replicate";
import { LAUNCH_CONSTANTS, pvAudienceName } from "@/lib/engine/launch";
import {
  DEFAULT_CATALOGUE_ID,
  REAL_CATALOGUES,
  REAL_PRODUCT_SETS,
} from "../../../../scripts/real-catalogue-data";
import { INDIA_CITIES, lookupCity } from "../../../../scripts/india-cities";
import { localBlueprint, readBlueprint } from "@/lib/meta/blueprint";
import { buildPublishPlan, executePlan, type AudienceRef } from "@/lib/meta/publish";
import { listCustomAudiences } from "@/lib/meta/audiences";
import { ensureProductSet } from "@/lib/meta/product-sets";
import { resolveCityGeo } from "@/lib/meta/geo";

/** Campaigns that can be used as a replication source, with their ad set shapes. */
export async function GET(req: Request) {
  const { error } = await requireAccount(req);
  if (error) return error;

  const [campaignRows, settings, cityRows] = await Promise.all([
    getCampaignMetrics("30d"),
    getAdSetSettings(),
    getCityMetrics(),
  ]);

  const byCampaign = new Map<string, typeof settings>();
  const adSetRows = await db.select().from(adSetsTable);
  const campaignIdByAdSet = new Map(adSetRows.map((a) => [a.id, a.campaignId]));
  for (const s of settings) {
    const cid = campaignIdByAdSet.get(s.adSetId);
    if (!cid) continue;
    const bucket = byCampaign.get(cid);
    if (bucket) bucket.push(s);
    else byCampaign.set(cid, [s]);
  }

  const sources = campaignRows
    .map((c) => describeSource(c, byCampaign.get(c.campaignId) ?? []))
    .filter((s) => s.adSets.length > 0);

  return NextResponse.json({
    sources,
    catalogues: REAL_CATALOGUES,
    productSets: REAL_PRODUCT_SETS,
    defaultCatalogueId: DEFAULT_CATALOGUE_ID,
    knownCities: INDIA_CITIES,
    existingCityNames: cityRows.map((c) => c.cityName),
    adSetSettings: settings,
  });
}

interface ReplicateBody {
  sourceCampaignId: string;
  cityNames: string[];
  dailyBudget: number;
  cplCeiling: number;
  pixelVerified: boolean;
  catalogueId?: string | null;
  manualStates?: Record<string, string>;
  manualProductSets?: Record<string, { productSetId: string; name: string; productCount: number }>;
  /** Distinguishing labels for cities that already have a campaign. */
  labels?: Record<string, string>;
  /**
   * Existing Meta audiences, chosen by the operator, applied to every city in
   * the batch.
   *
   *   exclude — applied to the broad campaign, so a prospecting buy stops
   *             re-reaching people who already converted. Harmless at any size.
   *   include — NOT applied to the broad campaign. Targeting an audience turns
   *             a prospecting buy into a remarketing one, which is a different
   *             campaign, so it goes into the twin below rather than quietly
   *             changing what the main campaign is.
   */
  audiences?: { include?: string[]; exclude?: string[] };
  /**
   * A second, audience-based campaign per city, alongside the broad one.
   *
   * Given its own budget rather than a share of the first: a remarketing buy
   * reaching 12,000 people and a broad buy reaching two million are not
   * comparable, and splitting one number between them implies they are.
   */
  remarketingTwin?: { enabled?: boolean; dailyBudget?: number };
  /**
   * Put every city in this batch into ONE campaign with ONE ad set and one
   * shared budget, instead of a campaign each.
   *
   * `dailyBudget` then means the whole campaign's budget, not per city, and
   * Meta allocates between the cities. `groupName` is what it is called.
   */
  consolidate?: { enabled?: boolean; groupName?: string };
  /**
   * Where the batch goes.
   *   PLATFORM — write the plan locally, touch nothing in Meta.
   *   META     — create it in the ad account for real.
   * Defaulting to PLATFORM keeps the old behaviour for anything that does not
   * ask, which matters because the difference is real money.
   */
  destination?: "PLATFORM" | "META";
  /** Only read when destination is META. Paused is the safe default. */
  activate?: boolean;
}

/** True only when live publishing is deliberately switched on AND credentialed. */
function liveReady(): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (process.env.USE_MOCK_META !== "false") reasons.push("USE_MOCK_META is not set to false.");
  if (!process.env.META_ACCESS_TOKEN?.trim()) reasons.push("META_ACCESS_TOKEN is not set.");
  return { ok: reasons.length === 0, reasons };
}

/**
 * Replicate one campaign into several cities.
 *
 * The gates run again here, per city, and a city that fails is skipped rather
 * than created — a partial success is reported honestly instead of the whole
 * batch failing or, worse, half-creating.
 */
export async function POST(req: Request) {
  const { account, error } = await requireAccountEditor(req);
  if (error) return error;

  const body = (await req.json()) as ReplicateBody;
  if (!body.sourceCampaignId || !Array.isArray(body.cityNames) || body.cityNames.length === 0) {
    return NextResponse.json({ error: "Pick a source campaign and at least one city." }, { status: 400 });
  }

  const [campaignRows, settings, cityRows] = await Promise.all([
    getCampaignMetrics("30d"),
    getAdSetSettings(),
    getCityMetrics(),
  ]);

  const sourceCampaign = campaignRows.find((c) => c.campaignId === body.sourceCampaignId);
  if (!sourceCampaign) return NextResponse.json({ error: "Source campaign not found." }, { status: 404 });

  const adSetRows = await db.select().from(adSetsTable);
  const sourceAdSetIds = new Set(adSetRows.filter((a) => a.campaignId === body.sourceCampaignId).map((a) => a.id));
  const sourceSettings = settings.filter((s) => sourceAdSetIds.has(s.adSetId));
  const source = describeSource(sourceCampaign, sourceSettings);

  const catalogueId = body.catalogueId ?? source.catalogueId ?? DEFAULT_CATALOGUE_ID;
  const catalogueRow = REAL_CATALOGUES.find((c) => c.catalogueId === catalogueId) ?? null;

  const plan = buildReplicationPlan({
    source,
    cityNames: body.cityNames,
    dailyBudget: Number(body.dailyBudget) || source.dailyBudget,
    cplCeiling: Number(body.cplCeiling) || source.targetCpl,
    pixelVerified: Boolean(body.pixelVerified),
    existingCityNames: cityRows.map((c) => c.cityName),
    existingAdSets: settings,
    catalogue: catalogueRow
      ? {
          catalogueId: catalogueRow.catalogueId,
          catalogueName: catalogueRow.name,
          vertical: catalogueRow.vertical,
          inUse: catalogueRow.inUse,
        }
      : null,
    productSets: REAL_PRODUCT_SETS,
    manualStates: body.manualStates,
    manualProductSets: body.manualProductSets,
    labels: body.labels,
  });

  if (plan.launchable.length === 0) {
    return NextResponse.json(
      { error: "No city in this batch can be launched.", plan },
      { status: 422 }
    );
  }

  const created: {
    cityName: string;
    campaignId: string;
    campaignName: string;
    adSets: { id: string; name: string; kind: string; productSetName: string | null; productCount: number }[];
    pvAudience: string;
    /** Set when the campaign was actually created in the ad account. */
    meta?: { campaignId: string; adSetId?: string; adId?: string; audienceId?: string; status: string };
  }[] = [];

  const perCityBudget = Number(body.dailyBudget) || source.dailyBudget;
  const ceiling = Number(body.cplCeiling) || source.targetCpl;

  // ---------------------------------------------------------------- Meta path
  const toMeta = body.destination === "META";
  const live = liveReady();
  const metaFailures: { cityName: string; error: string; rolledBack: string[] }[] = [];
  // Decisions taken on the operator's behalf that they should be able to see —
  // notably a city resolved under a different official name (Gurgaon→Gurugram).
  const metaNotes: string[] = [];
  const metaResults = new Map<string, { campaignId: string; adSetId?: string; adId?: string; audienceId?: string }>();
  /** The audience-based second campaign per city, when one was asked for. */
  const twinResults: { cityName: string; campaignName: string; campaignId: string; adSetId?: string; adId?: string }[] = [];

  const twinWanted = Boolean(body.remarketingTwin?.enabled);
  const twinBudget = Number(body.remarketingTwin?.dailyBudget) || 0;

  if (toMeta) {
    if (!live.ok) {
      return NextResponse.json(
        { error: `Cannot create in Meta. ${live.reasons.join(" ")}`, plan },
        { status: 409 }
      );
    }
    // The cap is on what a CITY will spend per day, not on what one campaign
    // will. With a remarketing twin a city carries two budgets, and checking
    // only the first would let the real commitment quietly double past the cap
    // — which is the single number this guard exists to hold.
    const cap = Number(process.env.META_MAX_DAILY_BUDGET ?? 5000);
    const perCityTotal = perCityBudget + (twinWanted ? twinBudget : 0);
    if (perCityTotal > cap) {
      return NextResponse.json(
        {
          error:
            twinWanted && twinBudget > 0
              ? `₹${perCityBudget.toLocaleString("en-IN")} broad + ₹${twinBudget.toLocaleString("en-IN")} remarketing = ₹${perCityTotal.toLocaleString("en-IN")}/day per city, over the ₹${cap.toLocaleString("en-IN")}/day safety cap.`
              : `₹${perCityBudget.toLocaleString("en-IN")}/day per city exceeds the ₹${cap.toLocaleString("en-IN")}/day safety cap.`,
        },
        { status: 422 }
      );
    }

    const adAccountId = account.id;

    // --- resolve the chosen audiences, once for the batch -------------------
    // Resolved from Meta rather than trusted from the request: the page may
    // have been open for an hour, and an audience deleted in the meantime would
    // otherwise fail at publish with a bare id and no explanation.
    const wantInclude = body.audiences?.include ?? [];
    const wantExclude = body.audiences?.exclude ?? [];
    let includeAudiences: AudienceRef[] = [];
    let excludeAudiences: AudienceRef[] = [];

    // Always listed, not only when audiences were chosen — the list is also how
    // an existing page-visitor audience is found and reused. See below.
    const allAudiences = await listCustomAudiences(adAccountId).catch(() => []);
    const audienceIdByName = new Map<string, string>();
    for (const a of allAudiences) {
      // First wins: the list comes back with the usable ones first, and where a
      // name is duplicated the newest usable one is the one to reuse.
      if (!audienceIdByName.has(a.name.toLowerCase())) audienceIdByName.set(a.name.toLowerCase(), a.id);
    }

    if (wantInclude.length > 0 || wantExclude.length > 0) {
      const all = allAudiences;
      const byId = new Map(all.map((a) => [a.id, a]));
      const missing = [...wantInclude, ...wantExclude].filter((id) => !byId.has(id));
      if (missing.length > 0) {
        return NextResponse.json(
          {
            error: `${missing.length} chosen ${missing.length === 1 ? "audience is" : "audiences are"} no longer in the ad account (${missing.join(", ")}). Reload and pick again.`,
          },
          { status: 409 }
        );
      }
      const ref = (id: string): AudienceRef => {
        const a = byId.get(id)!;
        return { id: a.id, name: a.name, sizeUpper: a.sizeUpper, targetable: a.targetable, reason: a.reason };
      };
      includeAudiences = wantInclude.map(ref);
      excludeAudiences = wantExclude.map(ref);
    }

    if (twinWanted && includeAudiences.length === 0) {
      return NextResponse.json(
        {
          error:
            "A remarketing campaign was asked for but no audience was chosen to target. That would create a second broad campaign competing with the first in the same city, which is worse than not creating it.",
        },
        { status: 422 }
      );
    }
    if (twinWanted && twinBudget <= 0) {
      return NextResponse.json(
        { error: "The remarketing campaign needs its own daily budget." },
        { status: 422 }
      );
    }
    // Settings come from the source campaign as it exists in the account, not
    // from our record of it — that is what "takes every setting from an
    // existing campaign" has to mean once this is real.
    const blueprint = await readBlueprint(body.sourceCampaignId).catch(() =>
      localBlueprint({
        campaignId: sourceCampaign.campaignId,
        name: sourceCampaign.name,
        dailyBudget: sourceCampaign.dailyBudget,
      })
    );

    // ------------------------------------------------ consolidated campaign
    // One campaign, one ad set, every city — a different shape from the loop
    // below, so it is a separate branch rather than a flag threaded through it.
    if (body.consolidate?.enabled) {
      const resolved: { cityName: string; geoKey: string }[] = [];
      for (const target of plan.launchable) {
        const geo = await resolveCityGeo(target.cityName, target.state);
        if (!geo.ok) {
          // All or nothing. A consolidated campaign silently missing one of the
          // cities you asked for is worse than one that refuses to be created.
          return NextResponse.json(
            {
              error: `${geo.reason} Nothing was created — a consolidated campaign is all of its cities or none.`,
              plan,
            },
            { status: 409 }
          );
        }
        if (geo.note) metaNotes.push(geo.note);
        resolved.push({ cityName: target.cityName, geoKey: geo.key });
      }

      // One product set spanning every city, since one ad draws from one set.
      let productSet;
      try {
        productSet = await ensureProductSet(catalogueId, resolved.map((c) => c.cityName));
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : String(err), plan },
          { status: 422 }
        );
      }
      if (productSet.reused) {
        metaNotes.push(
          `Reused the existing product set "${productSet.name}" — it already covers exactly these cities.`
        );
      }

      const groupName = body.consolidate.groupName?.trim() || resolved.map((c) => c.cityName).join(" + ");
      const consolidatedPlan = buildPublishPlan(
        adAccountId,
        blueprint,
        {
          cityName: resolved[0].cityName,
          geoKey: resolved[0].geoKey,
          extraCities: resolved.slice(1),
          groupName,
          productSetId: productSet.productSetId,
          productCount: productSet.productCount,
          // The whole campaign's budget, not per city — Meta allocates.
          dailyBudget: perCityBudget,
          cplCeiling: ceiling,
          existingPvAudienceId: null,
          excludeAudiences,
          includeAudiences: twinWanted ? [] : includeAudiences,
        },
        { activate: Boolean(body.activate), mode: "LIVE" }
      );
      const res = await executePlan(consolidatedPlan, "LIVE");
      return NextResponse.json({
        consolidated: true,
        groupName,
        cities: resolved.map((c) => c.cityName),
        productSetId: productSet.productSetId,
        productSetName: productSet.name,
        productCount: productSet.productCount,
        ok: res.ok,
        campaignId: res.created.campaignId ?? null,
        adSetId: res.created.adSetId ?? null,
        adId: res.created.adId ?? null,
        error: res.error ?? null,
        rolledBack: res.rolledBack,
        notes: [...metaNotes, ...res.notes],
        plan,
      });
    }

    for (const target of plan.launchable) {
      try {
        // Meta targets cities by numeric key, and the name is not enough to
        // find the right one: "Gurgaon" resolves to a village in Maharashtra,
        // because Haryana's city is listed as Gurugram. resolveCityGeo checks
        // the match against the state we already know and refuses a mismatch —
        // see the comment at the top of lib/meta/geo.ts.
        const geo = await resolveCityGeo(target.cityName, target.state);
        if (!geo.ok) {
          metaFailures.push({
            cityName: target.cityName,
            error:
              geo.reason +
              (geo.candidates.length > 0
                ? ` Meta offered: ${geo.candidates.map((c) => `${c.name} (${c.region})`).join("; ")}.`
                : ""),
            rolledBack: [],
          });
          continue;
        }
        const geoKey = geo.key;
        if (geo.note) metaNotes.push(geo.note);

        const publishPlan = buildPublishPlan(
          adAccountId,
          blueprint,
          {
            cityName: target.cityName,
            geoKey,
            productSetId: target.productSet?.productSetId ?? "",
            productCount: target.productSet?.productCount ?? 0,
            dailyBudget: perCityBudget,
            cplCeiling: ceiling,
            // Reuse the city's page-visitor audience when one already exists.
            //
            // This was hardcoded to null, so every run created another
            // `CD-FB-Buy Used Car-PV-<city>-90Days-New`. The account now holds
            // NINE identically-named Gurgaon ones — six of them made within
            // twenty-five minutes on 4 September — because the audience is
            // deliberately kept when a failed launch rolls back, and each retry
            // then made a fresh one. Keeping it on rollback is still right; what
            // was missing is looking before creating.
            existingPvAudienceId:
              audienceIdByName.get(pvAudienceName(target.cityName).toLowerCase()) ?? null,
            label: target.label,
            // Exclusions only. Targeting an audience here would silently turn
            // the broad campaign into a remarketing one; that belongs in the
            // twin below, where it is a campaign of its own and named as such.
            excludeAudiences,
          },
          { activate: Boolean(body.activate), mode: "LIVE" }
        );
        const res = await executePlan(publishPlan, "LIVE");
        if (!res.ok || !res.created.campaignId) {
          metaFailures.push({
            cityName: target.cityName,
            error: res.error ?? "Publish failed.",
            rolledBack: res.rolledBack,
          });
          continue;
        }
        metaResults.set(target.cityName, {
          campaignId: res.created.campaignId,
          adSetId: res.created.adSetId,
          adId: res.created.adId,
          audienceId: res.created.audienceId,
        });

        // --- the audience-based second campaign for this city ---------------
        // Built after the broad one succeeded, and failing separately: a
        // remarketing campaign that cannot be created is not a reason to tear
        // down a working prospecting campaign that already exists.
        if (twinWanted) {
          const twinLabel = target.label ? `${target.label} Remarketing` : "Remarketing";
          const twinPlan = buildPublishPlan(
            adAccountId,
            blueprint,
            {
              cityName: target.cityName,
              geoKey,
              productSetId: target.productSet?.productSetId ?? "",
              productCount: target.productSet?.productCount ?? 0,
              dailyBudget: twinBudget,
              cplCeiling: ceiling,
              // The broad campaign for this city has just created or reused it;
              // the twin must not make a third.
              existingPvAudienceId:
                metaResults.get(target.cityName)?.audienceId ??
                audienceIdByName.get(pvAudienceName(target.cityName).toLowerCase()) ??
                null,
              label: twinLabel,
              includeAudiences,
              excludeAudiences,
            },
            { activate: Boolean(body.activate), mode: "LIVE" }
          );
          const twinRes = await executePlan(twinPlan, "LIVE");
          if (twinRes.ok && twinRes.created.campaignId) {
            twinResults.push({
              cityName: target.cityName,
              campaignName: replicaCampaignName(target.cityName, twinLabel),
              campaignId: twinRes.created.campaignId,
              adSetId: twinRes.created.adSetId,
              adId: twinRes.created.adId,
            });
          } else {
            metaFailures.push({
              cityName: `${target.cityName} (remarketing)`,
              error: `The broad campaign for ${target.cityName} was created; its remarketing twin was not. ${twinRes.error ?? "Publish failed."}`,
              rolledBack: twinRes.rolledBack,
            });
          }
        }
      } catch (err) {
        metaFailures.push({
          cityName: target.cityName,
          error: err instanceof Error ? err.message : String(err),
          rolledBack: [],
        });
      }
    }
  }

  for (const target of plan.launchable) {
    // A city Meta refused is not recorded locally either. A local row for a
    // campaign that does not exist is exactly the confusion this whole screen
    // was built to remove.
    if (toMeta && !metaResults.has(target.cityName)) continue;
    const known = lookupCity(target.cityName);
    const cityId = newId("city");
    await db.insert(cities).values({
      id: cityId,
      name: target.cityName,
      state: target.state ?? "Unknown",
      tier: known?.tier ?? "Tier 2",
      status: "HEALTHY",
      dailyBudget: perCityBudget,
      recommendedBudget: perCityBudget,
      targetCpl: ceiling,
    });

    // When it went to Meta, the Meta id IS the local id — the same way every
    // real campaign in this database is keyed. That keeps one campaign as one
    // row rather than a local copy shadowing a remote original.
    const metaOut = metaResults.get(target.cityName);
    const campaignId = metaOut?.campaignId ?? newId("camp");
    await db.insert(campaigns).values({
      id: campaignId,
      name: replicaCampaignName(target.cityName, target.label),
      objective: "WEBSITE_LEADS",
      status: toMeta && !body.activate ? "PAUSED" : "ACTIVE",
      structureType: "DEDICATED_CITY",
      audienceType: source.adSets.some((a) => a.kind === "REMARKETING") ? "RETARGETING" : "BROAD",
      inventoryFilter: JSON.stringify({ type: "ALL_INVENTORY", cities: [target.cityName] }),
      catalogueName: catalogueRow?.name ?? "",
      dailyBudget: perCityBudget,
      totalBudget: perCityBudget * 30,
      targetCpl: ceiling,
    });
    await db.insert(campaignCities).values({ id: newId("cc"), campaignId, cityId, budgetShare: 1 });

    const perAdSet = Math.floor(perCityBudget / Math.max(1, source.adSets.length));
    const madeAdSets: { id: string; name: string; kind: string; productSetName: string | null; productCount: number }[] = [];

    for (const template of source.adSets) {
      const id = metaOut?.adSetId && template === source.adSets[0] ? metaOut.adSetId : newId("adset");
      // Remarketing is re-pointed at the NEW city's own page-visitor audience.
      // Copying the source city's would advertise Nashik cars to Lucknow.
      const customAudiences = template.kind === "REMARKETING" ? [pvAudienceName(target.cityName)] : [];
      await db.insert(adSetsTable).values({
        id,
        campaignId,
        cityId,
        name: `${target.cityName} · ${template.kind === "BROAD" ? "Broad" : template.kind === "LOOKALIKE" ? "Lookalike" : "Remarketing"}`,
        status: "ACTIVE",
        optimizationGoal: LAUNCH_CONSTANTS.optimizationGoal,
        resultType: source.resultType,
        attributionSetting: source.attributionSetting,
        // Geo is replaced, not copied — copying it is what creates the
        // self-competition the geo audit exists to catch.
        geoCities: JSON.stringify([target.cityName]),
        geoRegions: JSON.stringify([]),
        customAudiences: JSON.stringify(customAudiences),
        excludedAudiences: JSON.stringify([]),
        lookalikeSource: template.lookalikeSource,
        catalogueId: catalogueRow?.catalogueId ?? null,
        catalogueName: catalogueRow?.name ?? null,
        // Re-resolved per city, never inherited.
        productSetId: target.productSet?.productSetId ?? null,
        productSetName: target.productSet?.name ?? null,
        productSetFilter: target.productSet?.filterRule ?? null,
        productCount: target.productSet?.productCount ?? 0,
        interests: JSON.stringify(template.interests),
        ageMin: template.ageMin,
        ageMax: template.ageMax,
        genders: JSON.stringify(template.genders),
        advantageAudience: template.advantageAudience,
        targetingOptimization: LAUNCH_CONSTANTS.targetingOptimization,
        dailyBudget: perAdSet,
        startedAt: new Date(),
      });
      madeAdSets.push({
        id,
        name: `${target.cityName} · ${template.kind}`,
        kind: template.kind,
        productSetName: target.productSet?.name ?? null,
        productCount: target.productSet?.productCount ?? 0,
      });
    }

    created.push({
      cityName: target.cityName,
      campaignId,
      campaignName: replicaCampaignName(target.cityName, target.label),
      adSets: madeAdSets,
      pvAudience: pvAudienceName(target.cityName),
      meta: metaOut
        ? { ...metaOut, status: body.activate ? "ACTIVE" : "PAUSED" }
        : undefined,
    });
  }

  return NextResponse.json({
    destination: toMeta ? "META" : "PLATFORM",
    activated: toMeta ? Boolean(body.activate) : false,
    // Cities Meta refused are reported separately from cities the gates
    // stopped — they are different problems with different fixes.
    metaFailures,
    metaNotes,
    twins: twinResults,
    created,
    skipped: plan.blocked.map((b) => ({
      cityName: b.cityName,
      // "Already in the platform" is no longer a reason on its own — a repeat
      // city is blocked only when it has no label, and that gate says so.
      reason: b.plan.gates.find((g) => g.status === "BLOCK")?.detail ?? "Blocked.",
    })),
    source: { campaignId: source.campaignId, name: source.name },
    totalDailyBudget: created.length * perCityBudget,
  });
}
