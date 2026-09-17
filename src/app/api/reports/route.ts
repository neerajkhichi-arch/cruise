import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { SEEDED_DATA_WITHHELD, seededDataAllowed } from "@/lib/platform-data";
import { db } from "@/lib/db/client";
import { performanceDaily, leads } from "@/lib/db/schema";
import { getCityMetrics, getCampaignMetrics, getVehicleMetrics } from "@/lib/queries";
import { hasRankableDelivery } from "@/lib/engine/types";
import { generateWeeklySummary } from "@/lib/engine/ai";
import { syncRecommendations } from "@/lib/engine/recommend";

const DAY = 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const { error } = await requireSession();
  if (error) return error;

  // Seeded demo tables are withheld on a live install — see lib/platform-data.ts.
  if (!seededDataAllowed()) {
    return NextResponse.json({ unavailable: true, reason: SEEDED_DATA_WITHHELD });
  }

  const { searchParams } = new URL(req.url);
  const period = (searchParams.get("period") ?? "weekly") as "daily" | "weekly" | "monthly";
  const days = period === "daily" ? 1 : period === "weekly" ? 7 : 30;

  const now = new Date();
  const start = new Date(now.getTime() - days * DAY);
  const prevStart = new Date(now.getTime() - 2 * days * DAY);

  const [perf, allLeads, cities, campaigns, vehicles, recs] = await Promise.all([
    db.select().from(performanceDaily),
    db.select().from(leads),
    getCityMetrics(),
    getCampaignMetrics(),
    getVehicleMetrics(),
    syncRecommendations(),
  ]);

  function totalsFor(from: Date, to: Date) {
    const rows = perf.filter((p) => p.date >= from && p.date < to);
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const leadsCount = rows.reduce((s, r) => s + r.leads, 0);
    const rowLeads = allLeads.filter((l) => l.createdAt >= from && l.createdAt < to);
    const qualified = rowLeads.filter((l) => l.stage === "QUALIFIED" || l.stage === "SOLD").length;
    return { spend, leads: leadsCount, qualified, cpl: leadsCount > 0 ? spend / leadsCount : 0, cpql: qualified > 0 ? spend / qualified : 0 };
  }

  const current = totalsFor(start, now);
  const previous = totalsFor(prevStart, start);

  // Only cities with delivery can be ranked. A city launched this week has a
  // cost per result of ₹0 for the arithmetic reason that it has no results, and
  // sorting on that puts it first.
  const rankable = cities.filter(hasRankableDelivery);
  const sortedByCpl = [...rankable].sort((a, b) => a.cpl - b.cpl);
  const bestCity = sortedByCpl[0] ?? cities[0];
  const worstCity = [...rankable].sort((a, b) => b.wowCplChange - a.wowCplChange)[0] ?? cities[0];

  const summary = cities.length
    ? generateWeeklySummary({
        totalSpend: current.spend,
        prevTotalSpend: previous.spend,
        totalLeads: current.leads,
        prevTotalLeads: previous.leads,
        cpl: current.cpl,
        prevCpl: previous.cpl,
        bestCity,
        worstCity,
      })
    : "Not enough data yet to generate a summary.";

  const approvedActions = recs.filter((r) => r.status === "APPROVED").slice(0, 10);

  return NextResponse.json({
    period,
    range: { start: start.toISOString(), end: now.toISOString() },
    totals: current,
    previousTotals: previous,
    summary,
    cities: cities.map((c) => ({
      name: c.cityName,
      spend: c.spend,
      leads: c.leads,
      cpl: c.cpl,
      qualifiedLeads: c.qualifiedLeads,
      cpql: c.cpql,
      wowCplChange: c.wowCplChange,
    })),
    campaigns: campaigns.map((c) => ({ name: c.name, status: c.status, spend: c.spend, leads: c.leads, cpl: c.cpl, ctr: c.ctr })),
    inventory: {
      total: vehicles.length,
      active: vehicles.filter((v) => v.availability === "ACTIVE").length,
      sold: vehicles.filter((v) => v.availability === "SOLD").length,
      noLead: vehicles.filter((v) => v.availability === "ACTIVE" && v.leads === 0 && v.spend > 300).length,
    },
    aiRecommendations: recs
      .filter((r) => r.status === "PENDING" && (r.scope === "CITY" || r.scope === "CAMPAIGN"))
      .slice(0, 8)
      .map((r) => ({ title: r.title, action: r.recommendedAction })),
    actionsTaken: approvedActions.map((r) => ({ title: r.title, action: r.recommendedAction, resolvedAt: r.resolvedAt?.toISOString() })),
  });
}
