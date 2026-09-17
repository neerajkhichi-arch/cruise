import { NextResponse } from "next/server";
import { requireAccount, requireAccountEditor } from "@/lib/api-auth";
import { localBlueprint, readBlueprint } from "@/lib/meta/blueprint";
import { buildPublishPlan, executePlan, type PublishTarget } from "@/lib/meta/publish";
import { resolveCityGeo } from "@/lib/meta/geo";
import { getCampaignMetrics, getCityMetrics } from "@/lib/queries";
import { REAL_PRODUCT_SETS, DEFAULT_CATALOGUE_ID, cityFilterRule } from "../../../../scripts/real-catalogue-data";
import { INDIA_CITIES, lookupCity } from "../../../../scripts/india-cities";
import { ACCOUNT, KNOWN_GEO_KEYS } from "../../../../scripts/verified-account-facts";

/**
 * Publishing a city into the real ad account.
 *
 * Guards, in the order they run. Each one exists because the alternative is a
 * campaign that spends money before anybody notices it is wrong:
 *
 *   - live mode must be switched on deliberately (USE_MOCK_META=false);
 *   - the operator must type the city name to confirm, so a stray click
 *     cannot start delivery;
 *   - the batch's total daily budget is capped, defaulting to ₹5,000/day;
 *   - the city name must resolve to exactly one Meta city;
 *   - blockers refuse the whole city rather than creating part of it.
 *
 * DRY_RUN is the default. Sending mode:"LIVE" is the only way to reach the API.
 */

const DEFAULT_DAILY_CAP = Number(process.env.META_MAX_DAILY_BUDGET ?? 5000);

/** True only when live publishing is deliberately switched on AND credentialed. */
function liveEnabled(): { enabled: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (process.env.USE_MOCK_META !== "false") reasons.push("USE_MOCK_META is not set to false.");
  if (!process.env.META_ACCESS_TOKEN?.trim()) reasons.push("META_ACCESS_TOKEN is not set.");
  if (!process.env.META_AD_ACCOUNT_ID?.trim()) reasons.push("META_AD_ACCOUNT_ID is not set.");
  return { enabled: reasons.length === 0, reasons };
}

/** Everything the publish screen needs to render before anything is chosen. */
export async function GET(req: Request) {
  const { account, error } = await requireAccount(req);
  if (error) return error;

  const live = liveEnabled();
  const [campaigns, cities] = await Promise.all([getCampaignMetrics("30d"), getCityMetrics()]);

  return NextResponse.json({
    live: {
      enabled: live.enabled,
      reasons: live.reasons,
      adAccountId: account.id,
      adAccountName: ACCOUNT.adAccountName,
      dailyCap: DEFAULT_DAILY_CAP,
    },
    sources: campaigns
      .filter((c) => c.spend > 0)
      .map((c) => ({
        campaignId: c.campaignId,
        name: c.name,
        cities: c.cities,
        dailyBudget: Math.round(c.dailyBudget),
        targetCpl: Math.round(c.targetCpl),
        cohort: c.cohort,
        cpl: Math.round(c.cpl),
        leads: c.leads,
      })),
    existingCityNames: cities.map((c) => c.cityName),
    knownCities: INDIA_CITIES,
    productSets: REAL_PRODUCT_SETS,
    defaultCatalogueId: DEFAULT_CATALOGUE_ID,
    knownGeoKeys: KNOWN_GEO_KEYS,
  });
}

interface PublishBody {
  mode?: "DRY_RUN" | "LIVE";
  sourceCampaignId: string;
  cityName: string;
  productSetId?: string;
  productCount?: number;
  dailyBudget: number;
  cplCeiling: number;
  /** Must equal cityName exactly for a LIVE run. */
  confirmation?: string;
  /** Geo key, when the operator has already disambiguated the city. */
  geoKey?: string;
  existingPvAudienceId?: string | null;
}

export async function POST(req: Request) {
  const { account, error } = await requireAccountEditor(req);
  if (error) return error;

  const body = (await req.json()) as PublishBody;
  const mode = body.mode === "LIVE" ? "LIVE" : "DRY_RUN";

  if (!body.sourceCampaignId || !body.cityName?.trim()) {
    return NextResponse.json({ error: "A source campaign and a city are required." }, { status: 400 });
  }

  const cityName = body.cityName.trim();
  const dailyBudget = Number(body.dailyBudget) || 0;

  // --- guards, before anything is read or written -------------------------
  const live = liveEnabled();
  if (mode === "LIVE") {
    if (!live.enabled) {
      return NextResponse.json(
        {
          error: `Live publishing is off. ${live.reasons.join(" ")} Until then only the preview is available.`,
        },
        { status: 409 }
      );
    }
    if (body.confirmation?.trim().toLowerCase() !== cityName.toLowerCase()) {
      return NextResponse.json(
        {
          error: `Type "${cityName}" to confirm. This creates a live, delivering campaign that begins spending at ₹${dailyBudget.toLocaleString("en-IN")}/day.`,
        },
        { status: 428 }
      );
    }
    if (dailyBudget > DEFAULT_DAILY_CAP) {
      return NextResponse.json(
        {
          error: `₹${dailyBudget.toLocaleString("en-IN")}/day exceeds the ₹${DEFAULT_DAILY_CAP.toLocaleString("en-IN")}/day safety cap. Raise META_MAX_DAILY_BUDGET deliberately if that is really the intent.`,
        },
        { status: 422 }
      );
    }
    if (dailyBudget <= 0) {
      return NextResponse.json({ error: "A live campaign needs a daily budget." }, { status: 422 });
    }
  }

  try {
    // With credentials the blueprint comes from the API, which is the only
    // fully truthful source. Without them the preview still works, from values
    // read off the account and recorded in verified-account-facts.ts.
    let blueprint;
    let blueprintSource: "META_API" | "RECORDED";
    if (live.enabled) {
      blueprint = await readBlueprint(body.sourceCampaignId);
      blueprintSource = "META_API";
    } else {
      const campaigns = await getCampaignMetrics("30d");
      const c = campaigns.find((x) => x.campaignId === body.sourceCampaignId);
      if (!c) return NextResponse.json({ error: "Source campaign not found." }, { status: 404 });
      blueprint = localBlueprint({ campaignId: c.campaignId, name: c.name, dailyBudget: c.dailyBudget });
      blueprintSource = "RECORDED";
    }

    // --- resolve the city to Meta's own key ------------------------------
    // An explicit geoKey in the request is an operator who has already been
    // shown the choices and picked one, so it wins. Otherwise resolveCityGeo
    // decides — and refuses a match that is in the wrong state, which is how a
    // Gurgaon replica ended up targeting a village in Maharashtra. See the
    // comment at the top of lib/meta/geo.ts.
    let geoKey = body.geoKey ?? "";
    let geoNote: string | null = null;
    if (!geoKey && live.enabled) {
      const geo = await resolveCityGeo(cityName, lookupCity(cityName)?.state ?? null);
      if (geo.ok) {
        geoKey = geo.key;
        geoNote = geo.note;
      } else {
        return NextResponse.json(
          { error: geo.reason, choices: geo.candidates },
          { status: 409 }
        );
      }
    } else if (!geoKey) {
      geoKey = KNOWN_GEO_KEYS[cityName.toLowerCase()] ?? "";
    }

    const known = REAL_PRODUCT_SETS.find(
      (p) => p.cityKey?.toLowerCase() === cityName.toLowerCase()
    );
    const target: PublishTarget = {
      cityName,
      geoKey,
      productSetId: body.productSetId || known?.productSetId || "",
      productCount: Number(body.productCount) || known?.productCount || 0,
      dailyBudget,
      cplCeiling: Number(body.cplCeiling) || 0,
      existingPvAudienceId: body.existingPvAudienceId ?? null,
    };

    const plan = buildPublishPlan(
      // `??` would let an empty string through and produce `act_/campaigns`,
      // which looks like a working path and is not one.
      account.id,
      blueprint,
      target,
      { activate: true, mode }
    );
    const result = await executePlan(plan, mode);

    return NextResponse.json(
      {
        mode,
        blueprintSource,
        expectedFilterRule: cityFilterRule(cityName),
        source: {
          campaignId: blueprint.campaign.id,
          campaignName: blueprint.campaign.name,
          objective: blueprint.campaign.objective,
          adSetName: blueprint.adSet.name,
          optimizationGoal: blueprint.adSet.optimizationGoal,
          promotedObject: blueprint.adSet.promotedObject,
          attributionSetting: blueprint.adSet.attributionSetting,
          sourceCity: blueprint.adSet.sourceCityName,
          pvAudience: blueprint.pvAudience?.name ?? null,
          creativeProductSet: blueprint.creative?.productSetId ?? null,
        },
        target,
        plan: { notes: geoNote ? [geoNote, ...plan.notes] : plan.notes, blockers: plan.blockers },
        result,
      },
      { status: result.ok ? 200 : 422 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), mode },
      { status: 502 }
    );
  }
}
