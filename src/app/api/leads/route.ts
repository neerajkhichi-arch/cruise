import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { SEEDED_DATA_WITHHELD, seededDataAllowed } from "@/lib/platform-data";
import { db } from "@/lib/db/client";
import { leads, cities, performanceDaily } from "@/lib/db/schema";
import { gte } from "drizzle-orm";

const DAY = 24 * 60 * 60 * 1000;

export async function GET() {
  const { error } = await requireSession();
  if (error) return error;

  // Seeded demo tables are withheld on a live install — see lib/platform-data.ts.
  if (!seededDataAllowed()) {
    return NextResponse.json({ unavailable: true, reason: SEEDED_DATA_WITHHELD });
  }

  const last7Start = new Date(Date.now() - 7 * DAY);
  const [allCities, leadRows, perfRows] = await Promise.all([
    db.select().from(cities),
    db.select().from(leads).where(gte(leads.createdAt, last7Start)),
    db.select().from(performanceDaily).where(gte(performanceDaily.date, last7Start)),
  ]);

  const funnel = allCities.map((city) => {
    const cityLeads = leadRows.filter((l) => l.cityId === city.id);
    const total = cityLeads.length;
    const valid = cityLeads.filter((l) => l.stage !== "INVALID").length;
    const qualified = cityLeads.filter((l) => l.stage === "QUALIFIED" || l.stage === "SOLD").length;
    const sales = cityLeads.filter((l) => l.stage === "SOLD").length;
    const spend = perfRows.filter((p) => p.cityId === city.id).reduce((s, p) => s + p.spend, 0);
    const clicks = perfRows.filter((p) => p.cityId === city.id).reduce((s, p) => s + p.clicks, 0);
    const impressions = perfRows.filter((p) => p.cityId === city.id).reduce((s, p) => s + p.impressions, 0);

    return {
      cityId: city.id,
      cityName: city.name,
      impressions,
      clicks,
      leads: total,
      valid,
      qualified,
      sales,
      cpl: total > 0 ? spend / total : 0,
      cpql: qualified > 0 ? spend / qualified : 0,
    };
  });

  const bySource = Object.entries(
    leadRows.reduce<Record<string, number>>((acc, l) => {
      acc[l.source] = (acc[l.source] ?? 0) + 1;
      return acc;
    }, {})
  ).map(([source, count]) => ({ source, count }));

  return NextResponse.json({ funnel: funnel.sort((a, b) => b.leads - a.leads), bySource });
}
