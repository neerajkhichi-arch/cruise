import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { vehicles, cities } from "@/lib/db/schema";
import { newId } from "@/lib/id";
import { requireEditor } from "@/lib/api-auth";

const REQUIRED_HEADERS = ["vehiclecode", "make", "model", "variant", "year", "price", "fuel", "transmission", "kmdriven", "dealer"];

// `city` is optional in the CSV, but when present it is how a NEW market enters
// the platform. Previously the only way to add a city was to edit the seed
// script and wipe the database, which meant a city could never be added at all
// in a running deployment. Inventory arriving in a market is the real-world
// event that makes that market advertisable, so that is the trigger.
const OPTIONAL_HEADERS = ["city", "state"] as const;

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

export async function POST(req: Request) {
  const { error } = await requireEditor();
  if (error) return error;

  const body = await req.json();
  const method: "CSV" | "API" | "SHEET" | "FEED_URL" = body.method;
  const cityId: string | undefined = body.cityId;

  if (method === "CSV" && typeof body.csvText === "string" && body.csvText.trim()) {
    const rows = parseCsv(body.csvText);
    const missingHeaders = REQUIRED_HEADERS.filter((h) => !Object.keys(rows[0] ?? {}).includes(h));
    if (rows.length === 0 || missingHeaders.length > 0) {
      return NextResponse.json(
        {
          error: `CSV is missing required columns: ${missingHeaders.join(", ") || "no rows found"}. Expected headers: ${REQUIRED_HEADERS.join(", ")}. Optional: ${OPTIONAL_HEADERS.join(", ")} — include \`city\` to open a new market from the feed.`,
        },
        { status: 400 }
      );
    }
    // Resolve, and where necessary create, a city per row.
    const existing = await db.select().from(cities);
    const cityIdByName = new Map(existing.map((c) => [c.name.trim().toLowerCase(), c.id]));
    const createdCities: string[] = [];

    for (const name of new Set(rows.map((r) => (r.city ?? "").trim()).filter(Boolean))) {
      if (cityIdByName.has(name.toLowerCase())) continue;
      const id = newId("city");
      await db.insert(cities).values({
        id,
        name,
        state: rows.find((r) => (r.city ?? "").trim() === name)?.state || "Unknown",
        // A new city has no delivery history, so it gets no invented CPL target.
        // The Cities screen prompts for a lead commitment and a CPL ceiling once
        // the market has enough delivery to set one honestly.
        targetCpl: 0,
        dailyBudget: 0,
      });
      cityIdByName.set(name.toLowerCase(), id);
      createdCities.push(name);
    }

    const fallbackCityId = cityId ?? existing[0]?.id ?? [...cityIdByName.values()][0];
    if (!fallbackCityId) {
      return NextResponse.json(
        { error: "No city found to assign inventory to. Add a `city` column to the CSV to create one." },
        { status: 400 }
      );
    }

    const resolveCity = (r: Record<string, string>) =>
      cityIdByName.get((r.city ?? "").trim().toLowerCase()) ?? fallbackCityId;

    const inserts = rows.map((r) => ({
      id: newId("veh"),
      vehicleCode: r.vehiclecode || newId("VEH"),
      make: r.make || "Unknown",
      model: r.model || "Unknown",
      variant: r.variant || "Base",
      year: parseInt(r.year) || new Date().getFullYear(),
      price: parseFloat(r.price) || 0,
      fuel: r.fuel || "Petrol",
      transmission: r.transmission || "Manual",
      kmDriven: parseInt(r.kmdriven) || 0,
      cityId: resolveCity(r),
      dealer: r.dealer || "Unassigned Dealer",
      images: JSON.stringify([`https://picsum.photos/seed/${encodeURIComponent(r.vehiclecode || newId())}/640/420`]),
      vehicleUrl: r.vehicleurl || "https://marketplace.example.com/cars/new",
      availability: "ACTIVE" as const,
      listedAt: new Date(),
      healthScore: 75,
      performanceScore: 50,
    }));

    for (let i = 0; i < inserts.length; i += 200) {
      await db.insert(vehicles).values(inserts.slice(i, i + 200));
    }

    return NextResponse.json({
      mode: "live",
      method,
      imported: inserts.length,
      updated: 0,
      priceChanges: 0,
      soldDetected: 0,
      citiesCreated: createdCities,
      message:
        createdCities.length > 0
          ? `Imported ${inserts.length} vehicles from CSV and opened ${createdCities.length} new ${createdCities.length === 1 ? "market" : "markets"}: ${createdCities.join(", ")}. Set a lead commitment and CPL ceiling for ${createdCities.length === 1 ? "it" : "them"} on the Cities screen.`
          : `Imported ${inserts.length} vehicles from CSV.`,
    });
  }

  // API / Google Sheet / Feed URL — no live external source is connected in
  // this demo build, so we simulate a realistic ingestion report instead of
  // silently doing nothing. Swap in a real fetch() + parser here once a feed
  // is configured in Settings > Inventory Integrations.
  const cityCount = (await db.select().from(cities)).length;
  const imported = Math.round(20 + Math.random() * 60);
  const updated = Math.round(80 + Math.random() * 200);
  const priceChanges = Math.round(5 + Math.random() * 25);
  const soldDetected = Math.round(3 + Math.random() * 15);

  return NextResponse.json({
    mode: "simulated",
    method,
    imported,
    updated,
    priceChanges,
    soldDetected,
    message: `Simulated ${method.replace("_", " ").toLowerCase()} sync across ${cityCount} cities — connect a real feed in Settings to make this live.`,
  });
}
