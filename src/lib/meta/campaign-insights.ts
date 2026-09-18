/**
 * Campaign metrics read from Meta, for a given date range.
 *
 * This replaces reading `performance_daily`, a local table that stopped being
 * written on 2026-09-01 and so showed a ten-day-old picture under a badge
 * saying "Live". Numbers that are stale but plausible are worse than numbers
 * that are missing.
 *
 * The rules carried over from the rest of the app, each of which the obvious
 * implementation gets wrong:
 *
 *   - CLASSIFY FROM SETTINGS, NEVER FROM NAMES. `CHD-Remarketing` may be a
 *     prospecting campaign and `Consolidated` may carry a custom audience. The
 *     funnel stage comes from whether the ad sets carry custom audiences; the
 *     city from `geo_locations.cities[].name`; the result type from what the ad
 *     set optimises for.
 *   - A COHORT IS result type + attribution. Cost is comparable only inside
 *     one, so both travel with the row.
 *   - ONLY THE PIXEL LEAD EVENT COUNTS AS A LEAD. Messaging campaigns report
 *     conversations, which are a different thing being bought.
 */

import { actPath, graphGet } from "./graph";
import { leadActionType, readTargetLocations } from "./city-leads";
import { TTL, cached } from "./cache";
import { getAllAdSets } from "./adsets";
import type { CampaignMetrics } from "../engine/types";
import type { AttributionSetting, FunnelStage, ResultType } from "../engine/classify";

interface AdSetRow {
  id: string;
  name: string;
  status: string;
  campaign_id: string;
  daily_budget?: string;
  optimization_goal?: string;
  promoted_object?: { custom_event_type?: string; custom_event_str?: string };
  targeting?: {
    geo_locations?: {
      cities?: { name: string }[];
      regions?: { name: string }[];
      countries?: string[];
      custom_locations?: { name?: string; address_string?: string }[];
      geo_markets?: { name: string }[];
    };
    custom_audiences?: { id: string; name: string }[];
  };
  attribution_spec?: { event_type: string; window_days: number }[];
}

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
}

interface InsightRow {
  campaign_id?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  frequency?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: { action_type: string; value: string }[];
  conversions?: { action_type: string; value: string }[];
  attribution_setting?: string;
}

const n = (v?: string) => (v ? Number(v) || 0 : 0);

/** Rupees. Meta returns budgets in paise. */
const fromMinorUnits = (v?: string) => (v ? Number(v) / 100 : 0);

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

/**
 * Meta's optimisation goal, mapped to the result types this app reasons about.
 * Anything unrecognised stays PIXEL_LEAD rather than inventing a category.
 */
function resultTypeFor(goal?: string, promoted?: AdSetRow["promoted_object"]): ResultType {
  if (goal === "CONVERSATIONS" || goal === "LEAD_GENERATION") {
    return goal === "CONVERSATIONS" ? "MESSAGING" : "LEAD_FORM";
  }
  if (promoted?.custom_event_type === "OTHER" || goal === "OFFSITE_CONVERSIONS") return "PIXEL_LEAD";
  return "PIXEL_LEAD";
}

function attributionFor(spec?: AdSetRow["attribution_spec"]): AttributionSetting {
  const a = spec?.[0];
  if (!a) return "1d_click";
  const key = `${a.window_days}d_${a.event_type}`;
  const known: AttributionSetting[] = ["1d_click", "1d_view_7d_click", "7d_click_1d_ev", "1d_view_7d_click_1d_ev"];
  return (known.find((k) => k === key) ?? "1d_click") as AttributionSetting;
}

export interface LiveCampaignsResult {
  campaigns: CampaignMetrics[];
  /** Live data has no target CPL or inventory — those live in the platform. */
  notes: string[];
}

export async function getLiveCampaignMetrics(
  adAccountId: string,
  range: { since: string; until: string }
): Promise<LiveCampaignsResult> {
  const action = leadActionType();
  const notes: string[] = [];

  // Structure is cached for minutes, insights for a minute. See cache.ts —
  // this account is rate-limited per ACCOUNT, so an uncached screen can lock
  // out the publish path as well as itself.
  const [campaigns, adSetRows, insightRows] = await Promise.all([
    cached(`campaigns:${adAccountId}`, TTL.structure, () =>
      pageAll<CampaignRow>(actPath(adAccountId, "campaigns"), {
        fields: "id,name,status,effective_status,daily_budget,lifetime_budget,start_time",
        limit: "200",
      })
    ),
    // One shared ad-set read - see lib/meta/adsets.ts. This used to be its own
    // sweep of the same edge under its own cache key.
    getAllAdSets<AdSetRow>(adAccountId),
    cached(`insights:campaign:${adAccountId}:${range.since}:${range.until}`, TTL.insights, () =>
      pageAll<InsightRow>(actPath(adAccountId, "insights"), {
        level: "campaign",
        fields:
          "campaign_id,spend,impressions,clicks,reach,frequency,ctr,cpc,cpm,actions,conversions,attribution_setting",
        time_range: JSON.stringify(range),
        limit: "500",
      })
    ),
  ]);

  const insightsByCampaign = new Map(insightRows.filter((r) => r.campaign_id).map((r) => [r.campaign_id!, r]));
  const adSetsByCampaign = new Map<string, AdSetRow[]>();
  for (const a of adSetRows) {
    const list = adSetsByCampaign.get(a.campaign_id) ?? [];
    list.push(a);
    adSetsByCampaign.set(a.campaign_id, list);
  }

  const rows: CampaignMetrics[] = campaigns.map((c) => {
    const sets = adSetsByCampaign.get(c.id) ?? [];
    const ins = insightsByCampaign.get(c.id);

    // --- where it is pointed, from targeting -------------------------------
    // Cities AND regions AND the rest. Reading only `cities` left
    // CHD-17aug-Consolidated with an empty city column while it spent ₹8,081:
    // it targets Chandigarh as a region, because Chandigarh is a UT and exists
    // in Meta's geo tree as both. The kind is shown when it is not a plain
    // city, since "Chandigarh (region)" is a broader buy than the city.
    const locations = [
      ...new Map(
        sets
          .flatMap((a) => readTargetLocations(a.targeting?.geo_locations))
          .map((l) => [`${l.type}:${l.name}`, l])
      ).values(),
    ];
    const cities = locations.map((l) => (l.type === "city" ? l.name : `${l.name} (${l.type})`));

    // --- stage, from whether the ad sets carry custom audiences ------------
    const stages = new Set<FunnelStage>(
      sets.map((a) => ((a.targeting?.custom_audiences?.length ?? 0) > 0 ? "REMARKETING" : "PROSPECTING"))
    );
    const stage: FunnelStage | "MIXED" =
      stages.size === 1 ? [...stages][0] : stages.size === 0 ? "PROSPECTING" : "MIXED";

    // --- cohort, from the ad set that spends the most ----------------------
    const dominant = sets[0];
    const resultType = resultTypeFor(dominant?.optimization_goal, dominant?.promoted_object);
    const attributionSetting = (ins?.attribution_setting as AttributionSetting) || attributionFor(dominant?.attribution_spec);

    // --- results, counted by what THIS campaign optimises for --------------
    //
    // The result type was already worked out above, from the ad set's own
    // optimisation goal - and then ignored, because every campaign's result was
    // counted against one account-wide pixel event. A lead form does not report
    // a pixel event and a messaging campaign does not either, so on an account
    // mixing all three, two of them read zero while Ads Manager showed
    // hundreds. The classification was right there; nothing used it.
    const all = [...(ins?.conversions ?? []), ...(ins?.actions ?? [])];
    const countOf = (type: string) => Number(all.find((x) => x.action_type === type)?.value ?? 0) || 0;
    const leads =
      resultType === "LEAD_FORM"
        ? // On-Facebook instant forms. Older accounts report the grouped
          // on-site action instead, so both are accepted and the larger taken -
          // they are the same leads counted under two names, never additive.
          Math.max(countOf("leadgen.other"), countOf("onsite_conversion.lead_grouped"))
        : resultType === "MESSAGING"
          ? Math.max(
              countOf("onsite_conversion.messaging_conversation_started_7d"),
              countOf("onsite_conversion.total_messaging_connection")
            )
          : // A website conversion, which is the only case where the account's
            // configured lead event applies.
            countOf(action);
    const spend = n(ins?.spend);
    const impressions = n(ins?.impressions);
    const clicks = n(ins?.clicks);
    const reach = n(ins?.reach);

    // Budget sits on the campaign for CBO, on the ad sets otherwise.
    const dailyBudget =
      fromMinorUnits(c.daily_budget) ||
      sets.reduce((sum, a) => sum + fromMinorUnits(a.daily_budget), 0);

    return {
      campaignId: c.id,
      name: c.name,
      status: c.status,
      cities,
      stage,
      resultType,
      attributionSetting,
      cohort: `${resultType}::${attributionSetting}`,
      dailyBudget,
      totalBudget: fromMinorUnits(c.lifetime_budget),
      spend,
      leads,
      cpl: leads > 0 ? spend / leads : 0,
      // Read back from Meta rather than recomputed — its rounding is the one
      // Ads Manager shows, and a recomputed figure differing in the last digit
      // is the kind of thing that makes a whole screen look untrustworthy.
      ctr: n(ins?.ctr),
      cpc: n(ins?.cpc),
      cpm: n(ins?.cpm),
      impressions,
      clicks,
      reach,
      // Frequency is impressions per person, not an average of daily values.
      frequency: n(ins?.frequency) || (reach > 0 ? impressions / reach : 0),
      // These two are the app's own planning numbers and have no Meta
      // equivalent. Zero here means "not set here", not "zero".
      targetCpl: 0,
      inventoryCount: 0,
      daysRunning: 0,
      window: range,
    };
  });

  if (rows.length > 0) {
    notes.push(
      "Target CPL and inventory are planning figures held in this platform, not in Meta, so they read as 0 on live rows."
    );
  }

  // A campaign with no delivery in the range is still worth listing — it is
  // how you see that something you expected to be running is not.
  rows.sort((a, b) => b.spend - a.spend);
  return { campaigns: rows, notes };
}
