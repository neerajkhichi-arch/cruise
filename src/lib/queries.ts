import { and, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { adSets, vehicles, performanceDaily, leads } from "@/lib/db/schema";
import type {
  AdSetMetrics,
  CityMetrics,
  CostSegment,
  MetricWindow,
  VehicleMetrics,
  CampaignMetrics,
} from "@/lib/engine/types";
import {
  type AdSetSettings,
  type AttributionSetting,
  type FunnelStage,
  type ResultType,
  classifyAudienceSource,
  classifyFunnelStage,
  cohortKey,
  hasGeoGuardrail,
  RESULT_TYPE_LABEL,
} from "@/lib/engine/classify";

const DAY = 24 * 60 * 60 * 1000;

/**
 * A YYYY-MM-DD range, in the ad account's timezone, turned into the timestamp
 * bounds the local performance rows are stored against.
 *
 * `until` is INCLUSIVE — a range of 1–11 September must contain the 11th, and
 * an exclusive bound here is the classic way to be one day short of Ads
 * Manager while looking correct.
 */
function rangeBounds(range: { since: string; until: string }) {
  const [y1, m1, d1] = range.since.split("-").map(Number);
  const [y2, m2, d2] = range.until.split("-").map(Number);
  return {
    from: new Date(Date.UTC(y1, m1 - 1, d1, 0, 0, 0)),
    to: new Date(Date.UTC(y2, m2 - 1, d2, 23, 59, 59)),
  };
}

function windows(now = new Date()) {
  const last7Start = new Date(now.getTime() - 7 * DAY);
  const prev7Start = new Date(now.getTime() - 14 * DAY);
  return { now, last7Start, prev7Start };
}

function sum(arr: number[]) {
  return arr.reduce((a, b) => a + b, 0);
}

const parse = (json: string): string[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const parseNums = (json: string): number[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(Number).filter((n) => !Number.isNaN(n)) : [];
  } catch {
    return [];
  }
};

function segmentLabel(resultType: ResultType, attribution: string, stage: FunnelStage) {
  const short = RESULT_TYPE_LABEL[resultType].split(" (")[0];
  return `${short} · ${attribution} · ${stage === "REMARKETING" ? "Remarketing" : "Prospecting"}`;
}

/**
 * Split a set of daily performance rows into comparable cost segments.
 * Rows are keyed by result type + attribution window + funnel stage; costs are
 * never summed across those boundaries. See src/lib/engine/classify.ts.
 */
function buildSegments(
  rows: { spend: number; leads: number; resultType: string; attributionSetting: string; adSetId: string | null; date: Date }[],
  stageByAdSet: Map<string, FunnelStage>,
  since7d: Date
): CostSegment[] {
  const acc = new Map<string, CostSegment>();
  for (const r of rows) {
    const stage = (r.adSetId ? stageByAdSet.get(r.adSetId) : undefined) ?? "PROSPECTING";
    const resultType = r.resultType as ResultType;
    const attributionSetting = r.attributionSetting as AttributionSetting;
    const key = `${resultType}::${attributionSetting}::${stage}`;
    let seg = acc.get(key);
    if (!seg) {
      seg = {
        resultType,
        attributionSetting,
        stage,
        label: segmentLabel(resultType, attributionSetting, stage),
        spend: 0,
        results: 0,
        costPerResult: 0,
        spend7d: 0,
        results7d: 0,
        costPerResult7d: 0,
        trendPct: 0,
      };
      acc.set(key, seg);
    }
    seg.spend += r.spend;
    seg.results += r.leads;
    if (r.date >= since7d) {
      seg.spend7d += r.spend;
      seg.results7d += r.leads;
    }
  }
  const out = [...acc.values()];
  for (const seg of out) {
    seg.costPerResult = seg.results > 0 ? seg.spend / seg.results : 0;
    seg.costPerResult7d = seg.results7d > 0 ? seg.spend7d / seg.results7d : 0;
    seg.trendPct =
      seg.costPerResult > 0 && seg.costPerResult7d > 0
        ? ((seg.costPerResult7d - seg.costPerResult) / seg.costPerResult) * 100
        : 0;
  }
  return out.sort((a, b) => b.spend - a.spend);
}

export async function getCityMetrics(): Promise<CityMetrics[]> {
  const { now, last7Start, prev7Start } = windows();

  const since30d = new Date(now.getTime() - 30 * DAY);
  const cityRows = await db.query.cities.findMany({ with: { vehicles: true } });
  // 30 days, so cost segments have a stable base; WoW still uses the 7d windows.
  const perf = await db.select().from(performanceDaily).where(gte(performanceDaily.date, since30d));
  const leadRows = await db.select().from(leads).where(gte(leads.createdAt, last7Start));
  const allAdSets = await db.select().from(adSets);
  const stageByAdSet = new Map<string, FunnelStage>(
    allAdSets.map((a) => [a.id, classifyFunnelStage({ customAudiences: parse(a.customAudiences) })])
  );

  return cityRows.map((city) => {
    const cityPerf = perf.filter((p) => p.cityId === city.id);
    const last7 = cityPerf.filter((p) => p.date >= last7Start);
    const prev7 = cityPerf.filter((p) => p.date < last7Start && p.date >= prev7Start);

    const spend = sum(last7.map((p) => p.spend));
    const clicks = sum(last7.map((p) => p.clicks));
    const impressions = sum(last7.map((p) => p.impressions));
    const leadsCount = sum(last7.map((p) => p.leads));

    // Cost per result is taken from the dominant cohort, never blended across
    // result types or attribution windows. A city running website leads on
    // 1d_click alongside WhatsApp conversations on 1d_view_7d_click has no
    // single meaningful CPL, and pretending otherwise was the core defect of
    // the previous model.
    const segments = buildSegments(cityPerf, stageByAdSet, last7Start);
    const segmentSpend = sum(segments.map((sg) => sg.spend));
    const primary = segments[0];
    const cpl = primary?.costPerResult ?? 0;
    const primaryCohortLabel = primary?.label ?? "No delivery in window";
    const primaryCohortSpendShare = segmentSpend > 0 && primary ? primary.spend / segmentSpend : 0;

    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;

    const prevSpend = sum(prev7.map((p) => p.spend));
    const prevClicks = sum(prev7.map((p) => p.clicks));
    const prevImpressions = sum(prev7.map((p) => p.impressions));
    const prevLeads = sum(prev7.map((p) => p.leads));
    const prevCpl = prevLeads > 0 ? prevSpend / prevLeads : 0;
    const prevCtr = prevImpressions > 0 ? (prevClicks / prevImpressions) * 100 : 0;
    const prevCpc = prevClicks > 0 ? prevSpend / prevClicks : 0;

    const cityLeadRows = leadRows.filter((l) => l.cityId === city.id);
    const qualifiedLeads = cityLeadRows.filter((l) => l.stage === "QUALIFIED" || l.stage === "SOLD").length;
    const sales = cityLeadRows.filter((l) => l.stage === "SOLD").length;
    const cpql = qualifiedLeads > 0 ? spend / qualifiedLeads : 0;

    const activeVehicles = city.vehicles.filter((v) => v.availability === "ACTIVE");
    const now7 = new Date(now.getTime() - 7 * DAY);
    const day60 = new Date(now.getTime() - 60 * DAY);
    const newInv7d = activeVehicles.filter((v) => v.listedAt >= now7).length;
    const old60d = activeVehicles.filter((v) => v.listedAt <= day60).length;
    const avgPrice = activeVehicles.length ? sum(activeVehicles.map((v) => v.price)) / activeVehicles.length : 0;

    const activeAsOf7dAgo = city.vehicles.filter((v) => v.listedAt <= now7 && (!v.soldAt || v.soldAt > now7)).length;
    const wowInventoryChange = activeAsOf7dAgo > 0 ? ((activeVehicles.length - activeAsOf7dAgo) / activeAsOf7dAgo) * 100 : 0;

    return {
      cityId: city.id,
      cityName: city.name,
      state: city.state,
      inventoryTotal: city.vehicles.length,
      inventoryActive: activeVehicles.length,
      inventoryNew7d: newInv7d,
      inventoryOld60d: old60d,
      avgPrice,
      spend,
      leads: leadsCount,
      qualifiedLeads,
      sales,
      cpl,
      primaryCohortLabel,
      primaryCohortSpendShare,
      segments,
      cpql,
      ctr,
      cpc,
      conversionRate: leadsCount > 0 ? (qualifiedLeads / leadsCount) * 100 : 0,
      wowCplChange: prevCpl > 0 ? ((cpl - prevCpl) / prevCpl) * 100 : 0,
      wowInventoryChange,
      wowCpcChange: prevCpc > 0 ? ((cpc - prevCpc) / prevCpc) * 100 : 0,
      wowCtrChange: prevCtr > 0 ? ((ctr - prevCtr) / prevCtr) * 100 : 0,
      dailyBudget: city.dailyBudget,
      targetCpl: city.targetCpl,
    };
  });
}

export async function getVehicleMetrics(): Promise<VehicleMetrics[]> {
  const rows = await db.query.vehicles.findMany({ with: { city: true } });
  const cityAvgPrice = new Map<string, number>();
  for (const cityId of new Set(rows.map((v) => v.cityId))) {
    const inCity = rows.filter((v) => v.cityId === cityId && v.availability === "ACTIVE");
    cityAvgPrice.set(cityId, inCity.length ? sum(inCity.map((v) => v.price)) / inCity.length : 0);
  }
  const now = new Date();
  return rows.map((v) => ({
    vehicleId: v.id,
    vehicleCode: v.vehicleCode,
    label: `${v.make} ${v.model} ${v.variant} ${v.year}`,
    cityName: v.city.name,
    spend: v.spend,
    impressions: v.impressions,
    clicks: v.clicks,
    leads: v.leads,
    ctr: v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0,
    cpl: v.leads > 0 ? v.spend / v.leads : 0,
    inventoryAgeDays: Math.floor((now.getTime() - v.listedAt.getTime()) / DAY),
    price: v.price,
    cityAvgPrice: cityAvgPrice.get(v.cityId) ?? v.price,
    availability: v.availability,
    performanceScore: v.performanceScore,
    healthScore: v.healthScore,
  }));
}

export async function getCampaignMetrics(
  window: MetricWindow | { since: string; until: string } = "30d"
): Promise<CampaignMetrics[]> {
  // A preset is still accepted so existing callers keep working, but an
  // explicit range is what the screens now pass — it is the only form that can
  // be matched against Ads Manager.
  const { now, last7Start } = windows();
  const bounds =
    typeof window === "string"
      ? {
          from: window === "7d" ? last7Start : new Date(now.getTime() - 30 * DAY),
          to: new Date(now.getTime() + DAY),
        }
      : rangeBounds(window);

  const campaignRows = await db.query.campaigns.findMany({
    with: { cities: { with: { city: true } }, adSets: true },
  });
  const perf = await db
    .select()
    .from(performanceDaily)
    .where(and(gte(performanceDaily.date, bounds.from), lte(performanceDaily.date, bounds.to)));
  const activeVehicles = await db.select().from(vehicles);

  const inventoryByCity = new Map<string, number>();
  for (const v of activeVehicles) {
    if (v.availability !== "ACTIVE") continue;
    inventoryByCity.set(v.cityId, (inventoryByCity.get(v.cityId) ?? 0) + 1);
  }

  return campaignRows.map((c) => {
    const rows = perf.filter((p) => p.campaignId === c.id);
    const spend = sum(rows.map((p) => p.spend));
    const clicks = sum(rows.map((p) => p.clicks));
    const impressions = sum(rows.map((p) => p.impressions));
    const leadsCount = sum(rows.map((p) => p.leads));
    const reach = sum(rows.map((p) => p.reach));
    // Frequency is impressions per person reached, not a mean of daily values —
    // averaging a ratio across days double-counts the days with less delivery.
    const avgFrequency = reach > 0 ? impressions / reach : 0;
    const inventoryCount = sum(c.cities.map((cc) => inventoryByCity.get(cc.cityId) ?? 0));

    // Stage, result type and attribution all come from the campaign's ad sets.
    // Nothing here reads c.name — see src/lib/engine/classify.ts for why.
    const stages = new Set(
      c.adSets.map((a) => classifyFunnelStage({ customAudiences: parse(a.customAudiences) }))
    );
    const stage: FunnelStage | "MIXED" =
      stages.size === 1 ? ([...stages][0] as FunnelStage) : stages.size === 0 ? "PROSPECTING" : "MIXED";
    const dominant = [...c.adSets].sort((x, y) => y.spend - x.spend)[0];
    const resultType = (dominant?.resultType ?? "PIXEL_LEAD") as ResultType;
    const attributionSetting = (dominant?.attributionSetting ?? "1d_click") as AttributionSetting;

    return {
      stage,
      resultType,
      attributionSetting,
      cohort: cohortKey({ resultType, attributionSetting }),
      campaignId: c.id,
      name: c.name,
      status: c.status,
      cities: c.cities.map((cc) => cc.city.name),
      dailyBudget: c.dailyBudget,
      totalBudget: c.totalBudget,
      spend,
      leads: leadsCount,
      cpl: leadsCount > 0 ? spend / leadsCount : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      impressions,
      clicks,
      reach,
      frequency: avgFrequency,
      targetCpl: c.targetCpl,
      inventoryCount,
      daysRunning: Math.floor((Date.now() - c.createdAt.getTime()) / DAY),
      window,
    };
  });
}

export async function getAccountTotals() {
  const cityMetrics = await getCityMetrics();
  const totalSpend = sum(cityMetrics.map((c) => c.spend));
  const totalLeads = sum(cityMetrics.map((c) => c.leads));
  const qualifiedLeads = sum(cityMetrics.map((c) => c.qualifiedLeads));
  const sales = sum(cityMetrics.map((c) => c.sales));
  return {
    totalSpend,
    totalLeads,
    qualifiedLeads,
    sales,
    cpl: totalLeads > 0 ? totalSpend / totalLeads : 0,
    cpql: qualifiedLeads > 0 ? totalSpend / qualifiedLeads : 0,
  };
}


/** Ad set level metrics — the layer the rules engine actually reasons over. */
export async function getAdSetMetrics(): Promise<AdSetMetrics[]> {
  const rows = await db.query.adSets.findMany({ with: { city: true } });
  return rows.map((a) => {
    const customAudiences = parse(a.customAudiences);
    const resultType = a.resultType as ResultType;
    const attributionSetting = a.attributionSetting as AttributionSetting;
    return {
      adSetId: a.id,
      campaignId: a.campaignId,
      name: a.name,
      status: a.status,
      cityId: a.cityId ?? null,
      cityName: a.city?.name ?? null,
      stage: classifyFunnelStage({ customAudiences }),
      audienceSource: classifyAudienceSource({ customAudiences, lookalikeSource: a.lookalikeSource }),
      lookalikeSource: a.lookalikeSource,
      catalogueName: a.catalogueName,
      productSetName: a.productSetName,
      productCount: a.productCount,
      resultType,
      attributionSetting,
      cohort: cohortKey({ resultType, attributionSetting }),
      hasGeoGuardrail: hasGeoGuardrail({ geoCities: parse(a.geoCities), geoRegions: parse(a.geoRegions) }),
      customAudiences,
      interests: parse(a.interests),
      ageMin: a.ageMin,
      ageMax: a.ageMax,
      genders: parseNums(a.genders),
      advantageAudience: a.advantageAudience,
      dailyBudget: a.dailyBudget,
      spend: a.spend,
      results: a.results,
      costPerResult: a.costPerResult,
      spend7d: a.spend7d,
      results7d: a.results7d,
      costPerResult7d: a.costPerResult7d,
      frequency: a.frequency,
      frequency7d: a.frequency7d,
      reach: a.reach,
      ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
    };
  });
}

/** The raw settings view, for rules that inspect targeting directly. */
export async function getAdSetSettings(): Promise<AdSetSettings[]> {
  const rows = await db.select().from(adSets);
  return rows.map((a) => ({
    adSetId: a.id,
    name: a.name,
    status: a.status,
    optimizationGoal: a.optimizationGoal,
    attributionSetting: a.attributionSetting as AttributionSetting,
    resultType: a.resultType as ResultType,
    geoCities: parse(a.geoCities),
    geoRegions: parse(a.geoRegions),
    customAudiences: parse(a.customAudiences),
    excludedAudiences: parse(a.excludedAudiences),
    lookalikeSource: a.lookalikeSource,
    catalogueId: a.catalogueId,
    catalogueName: a.catalogueName,
    productSetId: a.productSetId,
    productSetName: a.productSetName,
    productSetFilter: a.productSetFilter,
    productCount: a.productCount,
    interests: parse(a.interests),
    ageMin: a.ageMin,
    ageMax: a.ageMax,
    genders: parseNums(a.genders),
    advantageAudience: a.advantageAudience,
    targetingOptimization: a.targetingOptimization,
  }));
}

/**
 * Spend-weighted cost per result for each cohort. This is the ONLY valid
 * benchmark to judge a campaign against: a flat per-city CPL target compared
 * against a WhatsApp conversation cost is a category error.
 */
export async function getCohortTargets(): Promise<Map<string, number>> {
  const rows = await db.select().from(adSets);
  const acc = new Map<string, { spend: number; results: number }>();
  for (const a of rows) {
    if (a.results <= 0) continue;
    const key = cohortKey({ resultType: a.resultType as ResultType, attributionSetting: a.attributionSetting as AttributionSetting });
    const bucket = acc.get(key) ?? { spend: 0, results: 0 };
    bucket.spend += a.spend;
    bucket.results += a.results;
    acc.set(key, bucket);
  }
  const out = new Map<string, number>();
  for (const [key, v] of acc) if (v.results > 0) out.set(key, v.spend / v.results);
  return out;
}
