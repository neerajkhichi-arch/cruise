/**
 * Month-to-date leads per city, read from Meta.
 *
 * Three decisions here, each of which the obvious implementation gets wrong.
 *
 * 1. CITY COMES FROM TARGETING, NOT FROM THE NAME. The live account has
 *    campaigns called GGN-Consolidated-9sep, CHD-Remarketing, AHM_14TH_Aug.
 *    Parsing those would be guessing, and would silently mis-attribute the day
 *    someone types CHD for Chandigarh and someone else types Chandigarh. The
 *    city is read from each ad set's geo_locations.cities[].name, which is the
 *    same field that decides who actually sees the ad.
 *
 * 2. ONLY ONE ACTION TYPE COUNTS. Read from the live account on 2026-09-11, the
 *    lead campaigns report
 *      offsite_conversion.fb_pixel_custom.UCR_Lead_Submit_New
 *    while others report
 *      onsite_conversion.messaging_conversation_started_7d
 *    A WhatsApp conversation is not a website lead. Summing both would inflate
 *    every city and pause campaigns that had not hit their target.
 *
 * 3. ONE ATTRIBUTION SETTING AT A TIME. Counts under different attribution
 *    windows are different measurements of different things. Each ad set's own
 *    setting is carried through so a mixed total is visible as mixed rather
 *    than quietly averaged.
 */

import { graphGet, actPath } from "./graph";
import { CONVERSION_EVENT } from "../../../scripts/verified-account-facts";
import { startOfMonth, todayInAccountTz } from "../date-range";
import { TTL, cached } from "./cache";

/** The action Meta reports for this account's website lead event. */
export function leadActionType(): string {
  const event = process.env.META_CONVERSION_EVENT?.trim() || CONVERSION_EVENT;
  return `offsite_conversion.fb_pixel_custom.${event}`;
}

export interface CityLeadCount {
  cityName: string;
  leads: number;
  spend: number;
  /** Campaigns contributing to this city, so a pause knows what to act on. */
  campaigns: { campaignId: string; campaignName: string; status: string; adSetIds: string[] }[];
  /** Attribution settings seen. More than one means the total is mixed. */
  attributionSettings: string[];
}

export interface CityLeadsResult {
  since: string;
  until: string;
  cities: CityLeadCount[];
  /** Ad sets skipped, and why — never silently dropped. */
  notes: string[];
  /**
   * Campaigns holding at least one ad set that targets several places.
   *
   * Auto-pause acts on a CAMPAIGN. A consolidated ad set is already left out of
   * every city total, so such a campaign normally never reaches the pauser —
   * but a campaign carrying one single-city ad set AND one consolidated ad set
   * would appear under that single city, and pausing it would stop the other
   * cities too. They have their own budgets and their own targets and nobody
   * asked for them to stop. So they are named here and the pauser refuses them.
   */
  multiCityCampaignIds: string[];
  actionType: string;
}

interface AdSetRow {
  id: string;
  name: string;
  status: string;
  campaign_id: string;
  campaign?: { id: string; name: string; status: string };
  targeting?: {
    geo_locations?: {
      cities?: { key: number; name: string }[];
      regions?: { key: number; name: string }[];
      countries?: string[];
      custom_locations?: { name?: string; address_string?: string }[];
      geo_markets?: { name: string }[];
    };
  };
  promoted_object?: { custom_event_str?: string; custom_event_type?: string };
}

interface InsightRow {
  adset_id?: string;
  spend?: string;
  /** Standard actions — clicks, messaging, page engagement. */
  actions?: { action_type: string; value: string }[];
  /**
   * Conversions. A CUSTOM pixel event lands here, not in `actions` — which is
   * what the first version of this file got wrong, producing 0 leads for every
   * city while their spend read correctly. Both arrays are searched now, and
   * anything unmatched is reported rather than silently counted as zero.
   */
  conversions?: { action_type: string; value: string }[];
  attribution_setting?: string;
}

/**
 * Where an ad set is pointed, whatever kind of place that is.
 *
 * Reading only `geo_locations.cities` was wrong, and wrong quietly. The live
 * account has `CHD-17aug-Consolidated` targeting
 *   geo_locations.regions = [{key: 1726, name: "Chandigarh", country: "IN"}]
 * because Chandigarh is a Union Territory and exists in Meta's geo tree as both
 * a city and a region. That campaign's 106 leads and ₹8,081 of spend were being
 * dropped from Chandigarh's total, and its city column read "—", while
 * everything looked healthy.
 *
 * The TYPE travels with the name rather than being flattened away: a region
 * called Chandigarh is close enough to the city to count, but a region called
 * Maharashtra is not Nashik, and only the caller can see the difference.
 */
export interface TargetLocation {
  name: string;
  type: "city" | "region" | "country" | "custom" | "geo_market";
}

export function readTargetLocations(geo?: {
  cities?: { name: string }[];
  regions?: { name: string }[];
  countries?: string[];
  custom_locations?: { name?: string; address_string?: string }[];
  geo_markets?: { name: string }[];
}): TargetLocation[] {
  if (!geo) return [];
  return [
    ...(geo.cities ?? []).map((c) => ({ name: c.name, type: "city" as const })),
    ...(geo.regions ?? []).map((r) => ({ name: r.name, type: "region" as const })),
    ...(geo.geo_markets ?? []).map((g) => ({ name: g.name, type: "geo_market" as const })),
    ...(geo.custom_locations ?? [])
      .map((c) => c.name ?? c.address_string)
      .filter((n): n is string => Boolean(n))
      .map((name) => ({ name, type: "custom" as const })),
    ...(geo.countries ?? []).map((c) => ({ name: c, type: "country" as const })),
  ];
}

/** The lead count for one ad set, plus what was actually on offer if it is 0. */
function readLeads(row: InsightRow, action: string): { leads: number; seen: string[] } {
  const all = [...(row.conversions ?? []), ...(row.actions ?? [])];
  const hit = all.find((x) => x.action_type === action);
  if (hit) return { leads: Number(hit.value) || 0, seen: [] };
  return { leads: 0, seen: all.map((x) => x.action_type) };
}

/**
 * Month-to-date in the ACCOUNT's timezone.
 *
 * This used to be computed in UTC, which is 5½ hours behind Asia/Kolkata: for
 * the first 5½ hours of every Indian day it named the wrong day, and on the 1st
 * of a month it quietly included the tail of the previous one.
 */
export function currentMonthRange(now = new Date()): { since: string; until: string } {
  const today = todayInAccountTz(now);
  return { since: startOfMonth(today), until: today };
}

export async function getCityLeadsThisMonth(
  adAccountId: string,
  range?: { since: string; until: string },
  now = new Date()
): Promise<CityLeadsResult> {
  const { since, until } = range ?? currentMonthRange(now);
  const action = leadActionType();
  const notes: string[] = [];
  const unmatched: { adSetName: string; spend: number; seen: string[] }[] = [];

  // --- every ad set, with the geo that decides which city it belongs to -----
  const adSets: AdSetRow[] = await cached(`city-adsets:${adAccountId}`, TTL.structure, async () => {
  const adSets: AdSetRow[] = [];
  let after: string | undefined;
  do {
    const page = await graphGet<{ data: AdSetRow[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      actPath(adAccountId, "adsets"),
      {
        fields: "id,name,status,campaign_id,campaign{id,name,status},targeting{geo_locations},promoted_object",
        limit: "200",
        ...(after ? { after } : {}),
      }
    );
    adSets.push(...(page.data ?? []));
    after = page.paging?.next ? page.paging?.cursors?.after : undefined;
  } while (after);
  return adSets;
  });

  // --- insights over the range, at ad set level -----------------------------
  const insights = new Map<string, InsightRow>(
    await cached(`insights:adset:${adAccountId}:${since}:${until}`, TTL.insights, async () => {
  const rows: [string, InsightRow][] = [];
  let insightsAfter: string | undefined;
  do {
    const page = await graphGet<{ data: InsightRow[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      actPath(adAccountId, "insights"),
      {
        level: "adset",
        fields: "adset_id,spend,actions,conversions,attribution_setting",
        time_range: JSON.stringify({ since, until }),
        limit: "500",
        ...(insightsAfter ? { after: insightsAfter } : {}),
      }
    );
    for (const row of page.data ?? []) {
      if (row.adset_id) rows.push([row.adset_id, row]);
    }
    insightsAfter = page.paging?.next ? page.paging?.cursors?.after : undefined;
  } while (insightsAfter);
  return rows;
    })
  );

  // --- fold ad sets into cities --------------------------------------------
  const byCity = new Map<string, CityLeadCount>();
  const multiCityCampaignIds: string[] = [];

  for (const a of adSets) {
    const locations = readTargetLocations(a.targeting?.geo_locations);
    if (locations.length === 0) continue; // targets nowhere nameable; not ours
    if (locations.length > 1) {
      notes.push(
        `${a.name} targets ${locations.length} places (${locations.map((c) => c.name).join(", ")}), so its leads cannot be attributed to one. Excluded.`
      );
      const multiId = a.campaign?.id ?? a.campaign_id;
      if (multiId && !multiCityCampaignIds.includes(multiId)) multiCityCampaignIds.push(multiId);
      continue;
    }
    // A country-level ad set is not a city campaign and would swamp any city
    // total it were folded into.
    if (locations[0].type === "country") {
      notes.push(`${a.name} targets a whole country (${locations[0].name}), so it is not counted against any city.`);
      continue;
    }

    const row = insights.get(a.id);
    if (!row) continue; // no delivery this month

    const { leads, seen } = readLeads(row, action);
    const spend = row.spend ? Number(row.spend) : 0;

    // An ad set that spent money and reported nothing of this kind is worth
    // naming. It is either optimising for something else — a WhatsApp campaign
    // is the common case — or the event name has drifted, and the two look
    // identical from a total of zero.
    if (leads === 0 && spend > 0) {
      unmatched.push({ adSetName: a.name, spend, seen });
    }

    // An ad set optimising for something else contributes spend but no leads of
    // this kind. Counting its spend against a lead target is still honest; its
    // zero leads are a fact, not a gap.
    const cityName = locations[0].name;
    if (locations[0].type !== "city") {
      const note = `${a.name} targets ${cityName} as a ${locations[0].type}, not a city — counted under ${cityName}.`;
      if (!notes.includes(note)) notes.push(note);
    }
    const key = cityName.toLowerCase();
    const entry = byCity.get(key) ?? {
      cityName,
      leads: 0,
      spend: 0,
      campaigns: [],
      attributionSettings: [],
    };

    entry.leads += leads;
    entry.spend += spend;
    if (row.attribution_setting && !entry.attributionSettings.includes(row.attribution_setting)) {
      entry.attributionSettings.push(row.attribution_setting);
    }

    const campaignId = a.campaign?.id ?? a.campaign_id;
    const existing = entry.campaigns.find((c) => c.campaignId === campaignId);
    if (existing) {
      existing.adSetIds.push(a.id);
    } else {
      entry.campaigns.push({
        campaignId,
        campaignName: a.campaign?.name ?? campaignId,
        status: a.campaign?.status ?? "UNKNOWN",
        adSetIds: [a.id],
      });
    }

    byCity.set(key, entry);
  }

  // Spend with no leads of this kind, summarised rather than listed one by one.
  // If EVERY spending ad set reports nothing, the event name is the suspect and
  // the message says so — that is exactly the failure this file shipped with.
  if (unmatched.length > 0) {
    const types = [...new Set(unmatched.flatMap((u) => u.seen))].sort();
    const totalSpend = Math.round(unmatched.reduce((sum, u) => sum + u.spend, 0));
    const anyLeads = [...byCity.values()].some((c) => c.leads > 0);
    notes.push(
      `${unmatched.length} ad set${unmatched.length === 1 ? "" : "s"} spent ₹${totalSpend.toLocaleString("en-IN")} ` +
        `and reported no ${action}. ` +
        (anyLeads
          ? `They are optimising for something else — what they did report: ${types.slice(0, 8).join(", ") || "nothing"}.`
          : `NOTHING in the account reported that event, so the event name is more likely wrong than every campaign being dead. ` +
            `What was reported instead: ${types.slice(0, 8).join(", ") || "nothing at all"}.`)
    );
  }

  return {
    since,
    until,
    cities: [...byCity.values()].sort((a, b) => b.leads - a.leads),
    notes,
    multiCityCampaignIds,
    actionType: action,
  };
}
