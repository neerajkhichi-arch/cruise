import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { cities } from "@/lib/db/schema";
import { requireSession, requireEditor } from "@/lib/api-auth";
import { getCityMetrics } from "@/lib/queries";
import { recommendBudgetAllocation } from "@/lib/engine/budget";

export async function GET() {
  const { error } = await requireSession();
  if (error) return error;

  const cityMetrics = await getCityMetrics();
  const totalDailyBudget = cityMetrics.reduce((s, c) => s + c.dailyBudget, 0);
  const allocation = recommendBudgetAllocation(cityMetrics, totalDailyBudget);

  return NextResponse.json({ allocation, totalDailyBudget });
}

export async function POST(req: Request) {
  const { error } = await requireEditor();
  if (error) return error;

  const body = await req.json();
  const changes: { cityId: string; newBudget: number }[] = body.changes ?? [];
  if (!Array.isArray(changes) || changes.length === 0) {
    return NextResponse.json({ error: "No changes supplied" }, { status: 400 });
  }

  for (const change of changes) {
    await db.update(cities).set({ dailyBudget: change.newBudget, recommendedBudget: change.newBudget }).where(eq(cities.id, change.cityId));
  }

  return NextResponse.json({ ok: true, applied: changes.length });
}
