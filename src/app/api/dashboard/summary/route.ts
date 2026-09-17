import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { performanceDaily, vehicles, campaigns, leads, accountSettings } from "@/lib/db/schema";
import { requireSession } from "@/lib/api-auth";

const DAY = 24 * 60 * 60 * 1000;

export async function GET() {
  const { error } = await requireSession();
  if (error) return error;

  const now = new Date();
  const last7Start = new Date(now.getTime() - 7 * DAY);
  const prev7Start = new Date(now.getTime() - 14 * DAY);
  const last30Start = new Date(now.getTime() - 30 * DAY);

  const [perf, allLeads, allVehicles, allCampaigns, settings] = await Promise.all([
    db.select().from(performanceDaily),
    db.select().from(leads),
    db.select().from(vehicles),
    db.select().from(campaigns),
    db.query.accountSettings.findFirst({ where: eq(accountSettings.id, "singleton") }),
  ]);
  const avgDealMargin = settings?.avgDealMargin ?? 25000;

  function windowTotals(start: Date, end: Date) {
    const rows = perf.filter((p) => p.date >= start && p.date < end);
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const leadsCount = rows.reduce((s, r) => s + r.leads, 0);
    const rowLeads = allLeads.filter((l) => l.createdAt >= start && l.createdAt < end);
    const qualified = rowLeads.filter((l) => l.stage === "QUALIFIED" || l.stage === "SOLD").length;
    const sales = rowLeads.filter((l) => l.stage === "SOLD").length;
    return {
      spend,
      leads: leadsCount,
      qualified,
      sales,
      cpl: leadsCount > 0 ? spend / leadsCount : 0,
      cpql: qualified > 0 ? spend / qualified : 0,
    };
  }

  const current = windowTotals(last7Start, now);
  const previous = windowTotals(prev7Start, last7Start);

  const pctChange = (nowVal: number, prevVal: number) => (prevVal > 0 ? ((nowVal - prevVal) / prevVal) * 100 : 0);

  // 30-day daily series for the trend chart.
  const seriesDays: { date: string; spend: number; leads: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const dayStart = new Date(now.getTime() - i * DAY);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + DAY);
    const rows = perf.filter((p) => p.date >= dayStart && p.date < dayEnd);
    seriesDays.push({
      date: dayStart.toISOString().slice(0, 10),
      spend: Math.round(rows.reduce((s, r) => s + r.spend, 0)),
      leads: rows.reduce((s, r) => s + r.leads, 0),
    });
  }

  const activeInventory = allVehicles.filter((v) => v.availability === "ACTIVE").length;
  const activeCampaigns = allCampaigns.filter((c) => c.status === "ACTIVE").length;
  const activeCitiesCount = new Set(perf.filter((p) => p.date >= last7Start).map((p) => p.cityId)).size;

  return NextResponse.json({
    current: {
      ...current,
      activeCampaigns,
      activeCities: activeCitiesCount,
      activeInventory,
      totalInventory: allVehicles.length,
      roas: current.spend > 0 ? (current.sales * avgDealMargin) / current.spend : 0,
    },
    changes: {
      spend: pctChange(current.spend, previous.spend),
      leads: pctChange(current.leads, previous.leads),
      cpl: pctChange(current.cpl, previous.cpl),
      qualified: pctChange(current.qualified, previous.qualified),
      cpql: pctChange(current.cpql, previous.cpql),
      sales: pctChange(current.sales, previous.sales),
    },
    series: seriesDays,
    period: { last7Start: last7Start.toISOString(), last30Start: last30Start.toISOString() },
  });
}
