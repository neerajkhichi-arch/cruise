import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getVehicleMetrics } from "@/lib/queries";

export async function GET(req: Request) {
  const { error } = await requireSession();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category"); // top | poor | nolead
  const cityName = searchParams.get("city");
  const search = searchParams.get("search")?.toLowerCase();
  const limit = Number(searchParams.get("limit") ?? 50);

  let vehicles = await getVehicleMetrics();
  vehicles = vehicles.filter((v) => v.availability === "ACTIVE");

  if (cityName) vehicles = vehicles.filter((v) => v.cityName === cityName);
  if (search) vehicles = vehicles.filter((v) => v.label.toLowerCase().includes(search));

  const noLead = vehicles.filter((v) => v.leads === 0 && v.spend > 300).sort((a, b) => b.spend - a.spend);
  const poor = vehicles.filter((v) => v.spend > 200 && v.leads > 0).sort((a, b) => a.performanceScore - b.performanceScore).slice(0, 200);
  const top = [...vehicles].filter((v) => v.leads > 0).sort((a, b) => b.performanceScore - a.performanceScore);

  let result = vehicles;
  if (category === "top") result = top;
  else if (category === "poor") result = poor;
  else if (category === "nolead") result = noLead;

  return NextResponse.json({
    vehicles: result.slice(0, limit),
    total: result.length,
    counts: { top: top.length, poor: poor.length, noLead: noLead.length, all: vehicles.length },
  });
}
