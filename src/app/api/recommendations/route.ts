import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { syncRecommendations } from "@/lib/engine/recommend";

export async function GET(req: Request) {
  const { error } = await requireSession();
  if (error) return error;

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
