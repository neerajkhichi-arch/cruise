import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { cities } from "@/lib/db/schema";
import { requireSession, requireEditor } from "@/lib/api-auth";
import { getCityMetrics, getCampaignMetrics, getVehicleMetrics } from "@/lib/queries";
import { generateAIRecommendations } from "@/lib/engine/ai";
import { recommendCampaignStructure } from "@/lib/engine/budget";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireSession();
  if (error) return error;

  const [allCities, allCampaigns, allVehicles] = await Promise.all([getCityMetrics(), getCampaignMetrics(), getVehicleMetrics()]);
  const city = allCities.find((c) => c.cityId === params.id);
  if (!city) return NextResponse.json({ error: "City not found" }, { status: 404 });

  const campaigns = allCampaigns.filter((c) => c.cities.includes(city.cityName));
  const vehicles = allVehicles.filter((v) => v.cityName === city.cityName);
  const recommendations = generateAIRecommendations([city]);
  const structure = recommendCampaignStructure(city.inventoryTotal);

  const popularModels = Object.entries(
    vehicles.reduce<Record<string, number>>((acc, v) => {
      acc[v.label.split(" ").slice(0, 2).join(" ")] = (acc[v.label.split(" ").slice(0, 2).join(" ")] ?? 0) + 1;
      return acc;
    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }));

  return NextResponse.json({ city, campaigns, recommendations, structure, popularModels, vehicleCount: vehicles.length });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { session, error } = await requireEditor();
  if (error) return error;
  const body = await req.json();

  const updates: Partial<typeof cities.$inferInsert> = {};
  if (typeof body.dailyBudget === "number") updates.dailyBudget = body.dailyBudget;
  if (typeof body.targetCpl === "number") updates.targetCpl = body.targetCpl;

  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No valid fields" }, { status: 400 });

  await db.update(cities).set(updates).where(eq(cities.id, params.id));
  void session;
  return NextResponse.json({ ok: true });
}
