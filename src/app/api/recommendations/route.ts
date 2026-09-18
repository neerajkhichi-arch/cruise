import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { syncRecommendations } from "@/lib/engine/recommend";
import { SEEDED_DATA_WITHHELD, seededDataAllowed } from "@/lib/platform-data";

/**
 * The STORED recommendations feed.
 *
 * Everything it returns is derived from `cities`, `campaigns`, `vehicles` and
 * `performance_daily` — the tables scripts/seed.ts filled during development.
 * Those tables carry no ad account column: there is one set of rows for the
 * whole install, seeded from the Used Cars Sales account. On a multi-account
 * install this endpoint therefore returned the same used-car advice under every
 * account's name, which is worse than returning nothing — the switcher said
 * BikeDekho and the recommendations underneath were about used-car cities.
 *
 * Withheld on a live install for that reason. Recommendations that really are
 * per-account are computed from Meta at /api/recommendations/live.
 */
export async function GET(req: Request) {
  const { error } = await requireSession();
  if (error) return error;

  if (!seededDataAllowed()) {
    return NextResponse.json({
      unavailable: true,
      reason: SEEDED_DATA_WITHHELD,
      recommendations: [],
      total: 0,
      counts: { pending: 0, vehicleFlags: 0, cityAndCampaign: 0 },
    });
  }

  const { searchParams } = new URL(req.url);
  const source = searchParams.get("source"); // RULE | AI
  const scope = searchParams.get("scope"); // CAMPAIGN | CITY | VEHICLE | ACCOUNT
  const status = searchParams.get("status") ?? "PENDING";
  const limit = Number(searchParams.get("limit") ?? 50);

  let rows = await syncRecommendations();

  if (source) rows = rows.filter((r) => r.source === source);
  if (scope) rows = rows.filter((r) => r.scope === scope);
  if (status !== "ALL") rows = rows.filter((r) => r.status === status);

  rows = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const counts = {
    pending: rows.filter((r) => r.status === "PENDING").length,
    vehicleFlags: rows.filter((r) => r.scope === "VEHICLE").length,
    cityAndCampaign: rows.filter((r) => r.scope === "CITY" || r.scope === "CAMPAIGN").length,
  };

  return NextResponse.json({
    recommendations: rows.slice(0, limit).map((r) => ({
      id: r.id,
      source: r.source,
      ruleType: r.ruleType,
      scope: r.scope,
      title: r.title,
      reasons: JSON.parse(r.reasons) as string[],
      recommendedAction: r.recommendedAction,
      impactEstimate: r.impactEstimate,
      suggestedDailyBudget: r.suggestedDailyBudget,
      status: r.status,
      cityName: r.city?.name,
      campaignName: r.campaign?.name,
      createdAt: r.createdAt.toISOString(),
      resolvedByName: r.resolvedBy?.name,
    })),
    total: rows.length,
    counts,
  });
}
