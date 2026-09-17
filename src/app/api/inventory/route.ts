import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { vehicles, cities } from "@/lib/db/schema";
import { requireSession } from "@/lib/api-auth";

const DAY = 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const { error } = await requireSession();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const cityId = searchParams.get("cityId");
  const availability = searchParams.get("availability");
  const search = searchParams.get("search")?.toLowerCase();
  const limit = Number(searchParams.get("limit") ?? 100);
  const offset = Number(searchParams.get("offset") ?? 0);

  const [allVehicles, allCities] = await Promise.all([db.select().from(vehicles), db.select().from(cities)]);
  const cityById = new Map(allCities.map((c) => [c.id, c]));
  const now = new Date();

  let rows = allVehicles.map((v) => {
    const ageDays = Math.floor((now.getTime() - v.listedAt.getTime()) / DAY);
    return {
      id: v.id,
      vehicleCode: v.vehicleCode,
      make: v.make,
      model: v.model,
      variant: v.variant,
      year: v.year,
      price: v.price,
      previousPrice: v.previousPrice,
      fuel: v.fuel,
      transmission: v.transmission,
      kmDriven: v.kmDriven,
      cityId: v.cityId,
      cityName: cityById.get(v.cityId)?.name ?? "",
      dealer: v.dealer,
      images: JSON.parse(v.images) as string[],
      vehicleUrl: v.vehicleUrl,
      availability: v.availability,
      listedAt: v.listedAt.toISOString(),
      inventoryAgeDays: ageDays,
      healthScore: v.healthScore,
      performanceScore: v.performanceScore,
      spend: v.spend,
      leads: v.leads,
      cpl: v.leads > 0 ? v.spend / v.leads : 0,
      priceChanged: v.previousPrice != null,
      isOld: ageDays > 60,
      isNew: ageDays <= 7,
    };
  });

  if (cityId) rows = rows.filter((v) => v.cityId === cityId);
  if (availability) rows = rows.filter((v) => v.availability === availability);
  if (search) {
    rows = rows.filter((v) => `${v.make} ${v.model} ${v.variant} ${v.vehicleCode}`.toLowerCase().includes(search));
  }

  const summary = {
    total: rows.length,
    active: rows.filter((v) => v.availability === "ACTIVE").length,
    sold: rows.filter((v) => v.availability === "SOLD").length,
    newListings7d: rows.filter((v) => v.isNew && v.availability === "ACTIVE").length,
    old60d: rows.filter((v) => v.isOld && v.availability === "ACTIVE").length,
    priceChanges: rows.filter((v) => v.priceChanged).length,
    avgHealthScore: rows.length ? Math.round(rows.reduce((s, v) => s + v.healthScore, 0) / rows.length) : 0,
  };

  const total = rows.length;
  const paged = rows.slice(offset, offset + limit);

  return NextResponse.json({ vehicles: paged, total, summary });
}
