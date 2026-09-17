import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getCityMetrics } from "@/lib/queries";
import { recommendBudgetAllocation } from "@/lib/engine/budget";

export async function GET() {
  const { error } = await requireSession();
  if (error) return error;

  const cities = await getCityMetrics();
  const totalDailyBudget = cities.reduce((s, c) => s + c.dailyBudget, 0);
  const allocation = recommendBudgetAllocation(cities, totalDailyBudget);
  const allocationByCity = new Map(allocation.map((a) => [a.cityId, a]));

  const rows = cities.map((c) => ({
    ...c,
    recommendedBudget: allocationByCity.get(c.cityId)?.recommendedBudget ?? c.dailyBudget,
    status: c.wowCplChange > 15 || c.inventoryActive < 300 ? "CRITICAL" : c.wowCplChange > 6 ? "ATTENTION" : "HEALTHY",
  }));

  return NextResponse.json({ cities: rows });
}
