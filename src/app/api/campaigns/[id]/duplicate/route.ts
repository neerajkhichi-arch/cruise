import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { campaigns, campaignCities } from "@/lib/db/schema";
import { newId } from "@/lib/id";
import { requireEditor } from "@/lib/api-auth";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireEditor();
  if (error) return error;

  const original = await db.query.campaigns.findFirst({ where: eq(campaigns.id, params.id), with: { cities: true } });
  if (!original) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const newCampaignId = newId("camp");
  await db.insert(campaigns).values({
    id: newCampaignId,
    name: `${original.name} (Copy)`,
    objective: original.objective,
    status: "DRAFT",
    structureType: original.structureType,
    audienceType: original.audienceType,
    inventoryFilter: original.inventoryFilter,
    dailyBudget: original.dailyBudget,
    totalBudget: original.totalBudget,
    targetCpl: original.targetCpl,
    catalogueName: original.catalogueName,
  });

  for (const cc of original.cities) {
    await db.insert(campaignCities).values({ id: newId("cc"), campaignId: newCampaignId, cityId: cc.cityId, budgetShare: cc.budgetShare });
  }

  return NextResponse.json({ id: newCampaignId });
}
