import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { adSets as adSetsTable, campaigns, campaignCities, cities } from "@/lib/db/schema";
import { newId } from "@/lib/id";
import { requireSession, requireEditor } from "@/lib/api-auth";
import { getAdSetSettings, getCityMetrics } from "@/lib/queries";
import {
  DEFAULT_CATALOGUE_ID,
  REAL_CATALOGUES,
  REAL_PRODUCT_SETS,
  cityFilterRule,
} from "../../../../scripts/real-catalogue-data";
import {
  buildLaunchPlan,
  ceilingLadder,
  LAUNCH_CONSTANTS,
  planAdSets,
  pvAudienceName,
  remarketingReadiness,
  type LaunchAdSetKind,
} from "@/lib/engine/launch";

/**
 * Context for the launch wizard: the cities that already exist, the ad sets a
 * geo audit has to check against, and the seed cities a lookalike can be built
 * from. Everything the wizard needs to compute a plan, so the plan the operator
 * sees is the same one the server will re-derive on submit.
 */
export async function GET() {
  const { error } = await requireSession();
  if (error) return error;

  const [cityRows, settings] = await Promise.all([getCityMetrics(), getAdSetSettings()]);

  // A lookalike can only be seeded from cities that have actually converted.
  const converting = cityRows
    .filter((c) => c.leads > 0)
    .sort((a, b) => b.leads - a.leads)
    .map((c) => c.cityName);

  return NextResponse.json({
    cities: cityRows.map((c) => ({
      cityId: c.cityId,
      cityName: c.cityName,
      state: c.state,
      spend: c.spend,
      leads: c.leads,
      dailyBudget: c.dailyBudget,
      targetCpl: c.targetCpl,
      inventoryActive: c.inventoryActive,
      isNew: c.spend === 0,
    })),
    adSetSettings: settings,
    lookalikeSeedCities: converting.slice(0, 3),
    catalogues: REAL_CATALOGUES,
    productSets: REAL_PRODUCT_SETS,
    defaultCatalogueId: DEFAULT_CATALOGUE_ID,
    ladders: {
      BROAD: ceilingLadder("BROAD"),
      LOOKALIKE: ceilingLadder("LOOKALIKE"),
      REMARKETING: ceilingLadder("REMARKETING"),
    },
    constants: LAUNCH_CONSTANTS,
  });
}

interface LaunchBody {
  cityId?: string;
  newCity?: { name: string; state: string };
  cplCeiling: number | null;
  dailyBudget: number;
  adSetKinds: LaunchAdSetKind[];
  pixelVerified: boolean;
  catalogueId?: string | null;
  productSetId?: string | null;
  /** A set the operator just created in Commerce Manager and is recording. */
  newProductSet?: {
    productSetId: string;
    name: string;
    productCount: number;
    filterRule: string;
    cityKey: string | null;
  } | null;
  /** Optional: known 90-day page-visitor audience size, for the day-30 note. */
  pvAudienceSize?: number | null;
}

/**
 * Execute a launch. The gates are re-evaluated here rather than trusted from
 * the client — a BLOCK is a refusal, not a warning the UI happened to render.
 */
export async function POST(req: Request) {
  const { error } = await requireEditor();
  if (error) return error;

  const body = (await req.json()) as LaunchBody;
  const kinds = (body.adSetKinds ?? []).filter((k) => k === "BROAD" || k === "LOOKALIKE" || k === "REMARKETING");
  if (kinds.length === 0) {
    return NextResponse.json({ error: "Choose at least one ad set to launch." }, { status: 400 });
  }
  if (!body.cityId && !body.newCity?.name) {
    return NextResponse.json({ error: "Choose a city, or name a new one." }, { status: 400 });
  }

  const [cityRows, settings] = await Promise.all([getCityMetrics(), getAdSetSettings()]);
  const existing = body.cityId ? cityRows.find((c) => c.cityId === body.cityId) : undefined;
  const cityName = existing?.cityName ?? body.newCity!.name.trim();
  const state = existing?.state ?? body.newCity?.state?.trim() ?? "Unknown";

  if (!existing && cityRows.some((c) => c.cityName.toLowerCase() === cityName.toLowerCase())) {
    return NextResponse.json({ error: `${cityName} already exists. Pick it from the list instead.` }, { status: 400 });
  }

  const catalogue = REAL_CATALOGUES.find((c) => c.catalogueId === body.catalogueId) ?? null;
  const productSet = REAL_PRODUCT_SETS.find((p) => p.productSetId === body.productSetId) ?? null;
  // A product set must belong to the catalogue it is being bound with.
  const boundProductSet =
    body.newProductSet && body.newProductSet.productSetId.trim() && catalogue
      ? {
          productSetId: body.newProductSet.productSetId.trim(),
          name: body.newProductSet.name.trim(),
          productCount: Number(body.newProductSet.productCount) || 0,
          filterRule: body.newProductSet.filterRule || cityFilterRule(cityName),
          cityKey: body.newProductSet.cityKey,
        }
      : productSet && catalogue && productSet.catalogueId === catalogue.catalogueId
      ? {
          productSetId: productSet.productSetId,
          name: productSet.name,
          productCount: productSet.productCount,
          filterRule: productSet.filterRule,
          cityKey: productSet.cityKey,
        }
      : null;

  const plan = buildLaunchPlan({
    cityName,
    catalogue: catalogue
      ? {
          catalogueId: catalogue.catalogueId,
          catalogueName: catalogue.name,
          vertical: catalogue.vertical,
          inUse: catalogue.inUse,
        }
      : null,
    productSet: boundProductSet,
    cplCeiling: body.cplCeiling ?? null,
    dailyBudget: Number(body.dailyBudget) || 0,
    adSetKinds: kinds,
    pixelVerified: Boolean(body.pixelVerified),
    existingAdSets: settings,
    targetGeo: { cities: [cityName], regions: [] },
  });

  if (!plan.canLaunch) {
    return NextResponse.json(
      { error: "This launch is blocked.", gates: plan.gates.filter((g) => g.status === "BLOCK"), plan },
      { status: 422 }
    );
  }

  const ceiling = body.cplCeiling!;
  const seeds = cityRows.filter((c) => c.leads > 0).sort((a, b) => b.leads - a.leads).map((c) => c.cityName).slice(0, 3);
  const planned = planAdSets(cityName, kinds, Number(body.dailyBudget), seeds, boundProductSet);

  // --- create the city if it is new ---------------------------------------
  let cityId = existing?.cityId;
  if (!cityId) {
    cityId = newId("city");
    await db.insert(cities).values({
      id: cityId,
      name: cityName,
      state,
      tier: "Tier 2",
      status: "HEALTHY",
      dailyBudget: Number(body.dailyBudget),
      recommendedBudget: Number(body.dailyBudget),
      targetCpl: ceiling,
    });
  }

  // --- campaign ------------------------------------------------------------
  const campaignId = newId("camp");
  await db.insert(campaigns).values({
    id: campaignId,
    name: `UC | META | LEAD | ${cityName.toUpperCase()} | CATALOGUE | LAUNCH`,
    objective: "WEBSITE_LEADS",
    status: "ACTIVE",
    structureType: "DEDICATED_CITY",
    // Descriptive of what the ad sets do. Nothing reads this back to classify.
    audienceType: kinds.includes("REMARKETING") ? "RETARGETING" : "BROAD",
    inventoryFilter: JSON.stringify({ type: "ALL_INVENTORY", cities: [cityName] }),
    catalogueName: catalogue!.name,
    dailyBudget: Number(body.dailyBudget),
    totalBudget: Number(body.dailyBudget) * 30,
    targetCpl: ceiling,
  });
  await db.insert(campaignCities).values({
    id: newId("cc"),
    campaignId,
    cityId,
    budgetShare: 1,
  });

  // --- ad sets, every constant locked --------------------------------------
  const created: {
    id: string;
    name: string;
    kind: string;
    dailyBudget: number;
    ceiling: number;
    productSetName: string | null;
    productCount: number;
  }[] = [];
  for (const p of planned) {
    const id = newId("adset");
    await db.insert(adSetsTable).values({
      id,
      campaignId,
      cityId,
      name: p.name,
      status: "ACTIVE",
      optimizationGoal: LAUNCH_CONSTANTS.optimizationGoal,
      resultType: LAUNCH_CONSTANTS.resultType,
      attributionSetting: LAUNCH_CONSTANTS.attributionSetting,
      geoCities: JSON.stringify([cityName]),
      geoRegions: JSON.stringify([]),
      customAudiences: JSON.stringify(p.customAudiences),
      excludedAudiences: JSON.stringify([]),
      lookalikeSource: p.lookalikeSource,
      catalogueId: catalogue!.catalogueId,
      catalogueName: catalogue!.name,
      productSetId: boundProductSet!.productSetId,
      productSetName: boundProductSet!.name,
      productSetFilter: boundProductSet!.filterRule,
      productCount: boundProductSet!.productCount,
      interests: JSON.stringify([]),
      ageMin: LAUNCH_CONSTANTS.ageMin,
      ageMax: LAUNCH_CONSTANTS.ageMax,
      genders: JSON.stringify(LAUNCH_CONSTANTS.genders),
      advantageAudience: LAUNCH_CONSTANTS.advantageAudience,
      targetingOptimization: LAUNCH_CONSTANTS.targetingOptimization,
      dailyBudget: p.dailyBudget,
      startedAt: new Date(),
    });
    created.push({
      id,
      name: p.name,
      kind: p.kind,
      dailyBudget: p.dailyBudget,
      ceiling: p.ceiling,
      productSetName: p.productSetName,
      productCount: p.productCount,
    });
  }

  return NextResponse.json({
    campaign: { id: campaignId, cityId, cityName },
    adSets: created,
    plan,
    catalogue: { id: catalogue!.catalogueId, name: catalogue!.name },
    productSet: { id: boundProductSet!.productSetId, name: boundProductSet!.name, productCount: boundProductSet!.productCount },
    pvAudience: pvAudienceName(cityName),
    remarketing: remarketingReadiness(body.pvAudienceSize ?? null),
    nextReview: {
      day7: "Delivery check only — confirm spend, pixel and no policy rejections. Do not edit anything; an edit restarts learning.",
      day14: `First real comparison. Both ad sets sit in ${LAUNCH_CONSTANTS.resultType} · ${LAUNCH_CONSTANTS.attributionSetting}, so their costs are directly comparable. Requires ~50 conversions each before it counts.`,
      day30: "Check whether the 90-day page-visitor audience has filled enough to carry a remarketing ad set.",
    },
  });
}
