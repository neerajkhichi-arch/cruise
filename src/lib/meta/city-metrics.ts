/**
 * Performance by city, read from Meta, for a date range.
 *
 * The page this feeds used to read the local `city_metrics` view and showed
 * rows like Ahmedabad: spend ₹0, leads 0, CPL ₹30. Those three numbers cannot
 * all be true at once, which is the clearest possible sign that the data was
 * seeded rather than measured. It also listed Delhi NCR, Jaipur and Noida,
 * which this ad account does not target at all.
 *
 * Two decisions here are worth stating, because the obvious implementation gets
 * both wrong:
 *
 * AGGREGATE AT AD SET LEVEL, NOT CAMPAIGN LEVEL.
 *   Geo targeting lives on the ad set. A campaign with a Chandigarh ad set and
 *   a Mohali ad set has no single city, so attributing its whole spend to the
 *   first city found — or to both — invents delivery that did not happen.
 *   Reading insights at ad set level lets each city get exactly its own spend.
 *
 * AN AD SET THAT SPANS CITIES IS NOT ATTRIBUTED AT ALL.
 *   If one ad set targets Chandigarh AND Mohali, Meta does not report which of
 *   the two the spend went to, and neither can this. Splitting it evenly would
 *   be a guess wearing a number's clothes. Those ad sets are reported
 *   separately, with their spend, so the gap between the city rows and the
 *   account total is visible and explained rather than silently absorbed.
 *
 * City comes from `geo_locations`, never from the campaign name — the standing
 * rule in this codebase. Chandigarh is targeted as a REGION by
 * CHD-17aug-Consolidated, because Chandigarh is a union territory and exists in
 * Meta's geo tree as both a city and a region; grouping by name keeps those
 * together while the row still says which kinds were used.
 */

import { actPath, graphGet } from "./graph";
import { leadActionType, readTargetLocations } from "./city-leads";
import { TTL, cached } from "./cache";
import { getCatalogueCityCounts } from "./catalogue";
import { precedingWindow } from "./account-summary";
import { dayCount } from "../date-range";

export interface CityMetricRow {
  cityName: string;
  /** "city", "region", … — a region buy is broader than a city buy. */
  targetedAs: string[];
  adSetCount: number;
  activeAdSetCount: number;
  campaignIds: string[];
  dailyBudget: number;
  spend: number;
  leads: number;
  cpl: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  /** Previous equal-length window, for the delta. */
  previousSpend: number;
  previousLeads: number;
  previousCpl: number;
  /** Null when the previous window had no leads — a percentage needs a base. */
  cplChangePct: number | null;
  /** Vehicles in the Meta catalogue for this city; null when the city has no set. */
  inventory: number | null;
}

export interface UnattributedAdSet {
  adSetId: string;
  name: string;
  cities: string[];
  spend: number;
  leads: number;
}

export interface CityMetricsResult {
  range: { since: string; until: string };
  previous: { since: string; until: string };
  days: number;
  cities: CityMetricRow[];
  unattributed: UnattributedAdSet[];
  unattributedSpend: number;
  leadAction: string;
  notes: string[];
}

interface AdSetRow {
  id: string;
  name: string;
  status: string;
  campaign_id: string;
  daily_budget?: string;
  targeting?: {
    geo_locations?: {
      cities?: { name: string }[];
      regions?: { name: string }[];
      countries?: string[];
      custom_locations?: { name?: string; address_string?: string }[];
      geo_markets?: { name: string }[];
    };
  };
}

interface InsightRow {
  adset_id?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  actions?: { action_type: string; value: string }[];
  conversions?: { action_type: string; value: string }[];
}

const n = (v?: string) => (v ? Number(v) || 0 : 0);
const fromMinorUnits = (v?: string) => (v ? Number(v) / 100 : 0);

function readLeads(row: InsightRow | undefined, action: string): number {
  if (!row) return 0;
  // Custom pixel events land in `conversions`, standard ones in `actions`.
  const all = [...(row.conversions ?? []), ...(row.actions ?? [])];
  return Number(all.find((x) => x.action_type === action)?.value ?? 0) || 0;
}

async function pageAll<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  do {
    const page = await graphGet<{ data: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(path, {
      ...params,
      ...(after ? { after } : {}),
    });
    out.push(...(page.data ?? []));
    after = page.paging?.next ? page.paging?.cursors?.after : undefined;
  } while (after);
  return out;
}

function adSetInsights(adAccountId: string, range: { since: string; until: string }) {
  return pageAll<InsightRow>(actPath(adAccountId, "insights"), {
    level: "adset",
    fields: "adset_id,spend,impressions,clicks,ctr,cpc,actions,conversions",
    time_range: JSON.stringify(range),
    limit: "500",
  });
}

/** Mutable accumulator, collapsed into CityMetricRow at the end. */
interface Bucket {
  cityName: string;
  targetedAs: Set<string>;
  campaignIds: Set<string>;
  adSetCount: number;
  activeAdSetCount: number;
  dailyBudget: number;
  spend: number;
  leads: number;
  impressions: number;
  clicks: number;
  previousSpend: number;
  previousLeads: number;
}

function bucket(map: Map<string, Bucket>, cityName: string): Bucket {
  const key = cityName.toLowerCase();
  let b = map.get(key);
  if (!b) {
    b = {
      cityName,
      targetedAs: new Set(),
      campaignIds: new Set(),
      adSetCount: 0,
      activeAdSetCount: 0,
      dailyBudget: 0,
      spend: 0,
      leads: 0,
      impressions: 0,
      clicks: 0,
      previousSpend: 0,
      previousLeads: 0,
    };
    map.set(key, b);
  }
  return b;
}

export async function getLiveCityMetrics(
  adAccountId: string,
  range: { since: string; until: string },
  opts: { includeInventory?: boolean } = {}
): Promise<CityMetricsResult> {
  const action = leadActionType();
  const previous = precedingWindow(range);
  const notes: string[] = [];

  const [adSets, current, prior] = await Promise.all([
    // Same cache key as the Campaigns screen, so opening both costs one read.
    cached(`adsets-geo:${adAccountId}`, TTL.structure, () =>
      pageAll<AdSetRow>(actPath(adAccountId, "adsets"), {
        fields: "id,name,status,campaign_id,daily_budget,targeting{geo_locations}",
        limit: "200",
      })
    ),
    cached(`insights:adset:${adAccountId}:${range.since}:${range.until}`, TTL.insights, () =>
      adSetInsights(adAccountId, range)
    ),
    cached(`insights:adset:${adAccountId}:${previous.since}:${previous.until}`, TTL.insights, () =>
      adSetInsights(adAccountId, previous)
    ),
  ]);

  const nowById = new Map(current.filter((r) => r.adset_id).map((r) => [r.adset_id!, r]));
  const beforeById = new Map(prior.filter((r) => r.adset_id).map((r) => [r.adset_id!, r]));

  const buckets = new Map<string, Bucket>();
  const unattributed: UnattributedAdSet[] = [];

  for (const a of adSets) {
    const locations = [
      ...new Map(readTargetLocations(a.targeting?.geo_locations).map((l) => [`${l.type}:${l.name}`, l])).values(),
    ];
    // Distinct place names, so a set targeting Chandigarh as both a city and a
    // region is one place, not two.
    const names = [...new Set(locations.map((l) => l.name))];

    const ins = nowById.get(a.id);
    const before = beforeById.get(a.id);
    const spend = n(ins?.spend);
    const leads = readLeads(ins, action);

    if (names.length === 0) {
      // Country-only or untargeted. Not a city, and pretending otherwise is
      // how "Delhi NCR" ends up in a table.
      if (spend > 0) {
        unattributed.push({ adSetId: a.id, name: a.name, cities: [], spend, leads });
      }
      continue;
    }

    if (names.length > 1) {
      unattributed.push({ adSetId: a.id, name: a.name, cities: names, spend, leads });
      continue;
    }

    const b = bucket(buckets, names[0]);
    for (const l of locations) b.targetedAs.add(l.type);
    b.campaignIds.add(a.campaign_id);
    b.adSetCount += 1;
    if (a.status === "ACTIVE") b.activeAdSetCount += 1;
    b.dailyBudget += fromMinorUnits(a.daily_budget);
    b.spend += spend;
    b.leads += leads;
    b.impressions += n(ins?.impressions);
    b.clicks += n(ins?.clicks);
    b.previousSpend += n(before?.spend);
    b.previousLeads += readLeads(before, action);
  }

  // Inventory from the catalogue — the only inventory that can be advertised.
  let inventoryByCity = new Map<string, number>();
  if (opts.includeInventory !== false) {
    try {
      // Counts only. Fetching the vehicles themselves here cost about eight
      // extra Graph calls per page load and put this account over its rate
      // limit — which also blocks publishing.
      const cities = await getCatalogueCityCounts();
      inventoryByCity = new Map(cities.map((c) => [c.cityName.toLowerCase(), c.productCount]));
    } catch {
      // A catalogue failure must not take the performance table down with it.
      notes.push("Inventory could not be read from the catalogue, so that column is blank rather than guessed.");
    }
  }

  const cities: CityMetricRow[] = [...buckets.values()]
    .map((b) => {
      const cpl = b.leads > 0 ? b.spend / b.leads : 0;
      const previousCpl = b.previousLeads > 0 ? b.previousSpend / b.previousLeads : 0;
      return {
        cityName: b.cityName,
        targetedAs: [...b.targetedAs].sort(),
        adSetCount: b.adSetCount,
        activeAdSetCount: b.activeAdSetCount,
        campaignIds: [...b.campaignIds],
        dailyBudget: b.dailyBudget,
        spend: b.spend,
        leads: b.leads,
        cpl,
        impressions: b.impressions,
        clicks: b.clicks,
        ctr: b.impressions > 0 ? (b.clicks / b.impressions) * 100 : 0,
        cpc: b.clicks > 0 ? b.spend / b.clicks : 0,
        previousSpend: b.previousSpend,
        previousLeads: b.previousLeads,
        previousCpl,
        // Both windows need leads for a cost comparison to mean anything.
        cplChangePct: previousCpl > 0 && cpl > 0 ? ((cpl - previousCpl) / previousCpl) * 100 : null,
        inventory: inventoryByCity.has(b.cityName.toLowerCase())
          ? inventoryByCity.get(b.cityName.toLowerCase())!
          : null,
      };
    })
    .sort((a, b) => b.spend - a.spend);

  const unattributedSpend = unattributed.reduce((s, u) => s + u.spend, 0);
  if (unattributedSpend > 0) {
    notes.push(
      `${unattributed.length} ad set${unattributed.length === 1 ? "" : "s"} targeting more than one place (or no place) spent ` +
        `₹${Math.round(unattributedSpend).toLocaleString("en-IN")} in this range. Meta does not report which city that went to, ` +
        `so it is listed separately rather than split across the rows.`
    );
  }

  // A city with catalogue stock but no ad sets is a launch opportunity the
  // table would otherwise hide completely.
  for (const [key, count] of inventoryByCity) {
    if (!buckets.has(key) && count > 0) {
      notes.push(
        `${key.replace(/\b\w/g, (c) => c.toUpperCase())} has ${count.toLocaleString("en-IN")} vehicles in the catalogue and no ad set targeting it.`
      );
    }
  }

  return {
    range: { since: range.since, until: range.until },
    previous,
    days: dayCount({ ...range, preset: "custom" }),
    cities,
    unattributed: unattributed.sort((a, b) => b.spend - a.spend),
    unattributedSpend,
    leadAction: action,
    notes,
  };
}
