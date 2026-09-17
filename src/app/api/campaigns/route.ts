import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { campaigns, campaignCities, namingConvention } from "@/lib/db/schema";
import { newId } from "@/lib/id";
import { requireAccount, requireAccountEditor } from "@/lib/api-auth";
import { getCampaignMetrics, getCityMetrics } from "@/lib/queries";
import { recommendCampaignStructure } from "@/lib/engine/budget";
import { generateCampaignName } from "@/lib/engine/naming";
import { rangeFromParams } from "@/lib/date-range";
import { getLiveCampaignMetrics } from "@/lib/meta/campaign-insights";
import { GraphError } from "@/lib/meta/graph";

export async function GET(req: Request) {
  const { account, error } = await requireAccount(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const city = searchParams.get("city");
  const search = searchParams.get("search")?.toLowerCase();
  // The range comes from the URL so a link to this screen shows the same
  // numbers to whoever opens it, and is resolved in the ad account's timezone.
  const range = rangeFromParams(searchParams, "this_month");

  // Live when there is a token, local otherwise. The local table stopped being
  // written on 2026-09-01, so reading it while the badge says "Live" showed a
  // ten-day-old picture as though it were current. `source` travels with the
  // response so the screen can say which of the two it is showing.
  const live =
    process.env.USE_MOCK_META === "false" && Boolean(process.env.META_ACCESS_TOKEN?.trim());

  let rows;
  let source: "META" | "PLATFORM" = "PLATFORM";
  let notes: string[] = [];
  let sourceError: string | null = null;

  if (live) {
    try {
      const out = await getLiveCampaignMetrics(
        account.id,
        { since: range.since, until: range.until }
      );
      rows = out.campaigns;
      notes = out.notes;
      source = "META";
    } catch (err) {
      // Falling back silently would put stale numbers back on screen under a
      // live badge — the exact failure this change exists to remove. Say so.
      sourceError =
        err instanceof GraphError ? err.describe() : err instanceof Error ? err.message : String(err);
      rows = await getCampaignMetrics({ since: range.since, until: range.until });
    }
  } else {
    rows = await getCampaignMetrics({ since: range.since, until: range.until });
  }
  if (status) rows = rows.filter((c) => c.status === status);
  if (city) rows = rows.filter((c) => c.cities.includes(city));
  if (search) rows = rows.filter((c) => c.name.toLowerCase().includes(search));

  return NextResponse.json({ campaigns: rows, range, source, notes, sourceError });
}

export async function POST(req: Request) {
  const { error } = await requireAccountEditor(req);
  if (error) return error;

  const body = await req.json();
  const { objective, cityIds, dailyBudget, totalBudget, targetCpl, audienceType, inventoryFilter } = body;

  if (!objective || !Array.isArray(cityIds) || cityIds.length === 0 || !dailyBudget || !targetCpl || !audienceType) {
    return NextResponse.json({ error: "Missing required campaign fields." }, { status: 400 });
  }

  const [allCities, naming] = await Promise.all([
    getCityMetrics(),
    db.query.namingConvention.findFirst({ where: eq(namingConvention.id, "singleton") }),
  ]);
  const selectedCities = allCities.filter((c) => cityIds.includes(c.cityId));
  const totalInventory = selectedCities.reduce((s, c) => s + c.inventoryTotal, 0);
  const structure = recommendCampaignStructure(totalInventory);
  const template = naming?.template ?? "UC | META | {OBJECTIVE} | {CITY} | CATALOGUE | {AUDIENCE}";
  const cityLabel = selectedCities.length === 1 ? selectedCities[0].cityName : `${selectedCities[0]?.cityName ?? "MULTI"}-CLUSTER`;
  const name = generateCampaignName(template, { objective, cityLabel, audience: audienceType });

  const campaignId = newId("camp");
  await db.insert(campaigns).values({
    id: campaignId,
    name,
    objective,
    status: "ACTIVE",
    structureType: structure.structureType,
    audienceType,
    inventoryFilter: JSON.stringify(inventoryFilter ?? { type: "ALL_INVENTORY" }),
    dailyBudget,
    totalBudget: totalBudget ?? dailyBudget * 30,
    targetCpl,
  });

  const inventoryWeightTotal = selectedCities.reduce((s, c) => s + c.inventoryActive, 0) || 1;
  for (const city of selectedCities) {
    await db.insert(campaignCities).values({
      id: newId("cc"),
      campaignId,
      cityId: city.cityId,
      budgetShare: city.inventoryActive / inventoryWeightTotal,
    });
  }

  return NextResponse.json({
    campaign: { id: campaignId, name, structureType: structure.structureType, structureExplanation: structure.explanation },
  });
}
