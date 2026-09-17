import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  adSets,
  alerts,
  campaignCities,
  campaigns,
  cities,
  leads,
  recommendations,
} from "@/lib/db/schema";
import { requireSession, requireEditor } from "@/lib/api-auth";
import { getCampaignMetrics } from "@/lib/queries";
import { graphDelete, GraphError } from "@/lib/meta/graph";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireSession();
  if (error) return error;

  const all = await getCampaignMetrics();
  const campaign = all.find((c) => c.campaignId === params.id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const row = await db.query.campaigns.findFirst({ where: eq(campaigns.id, params.id), with: { cities: { with: { city: true } } } });

  return NextResponse.json({ campaign, detail: row });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireEditor();
  if (error) return error;
  const body = await req.json();

  const updates: Partial<typeof campaigns.$inferInsert> = {};
  if (body.action === "pause") updates.status = "PAUSED";
  if (body.action === "resume") updates.status = "ACTIVE";
  if (body.action === "increase_budget" && typeof body.amount === "number") {
    const current = await db.query.campaigns.findFirst({ where: eq(campaigns.id, params.id) });
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
    updates.dailyBudget = current.dailyBudget + body.amount;
  }
  if (body.action === "decrease_budget" && typeof body.amount === "number") {
    const current = await db.query.campaigns.findFirst({ where: eq(campaigns.id, params.id) });
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
    updates.dailyBudget = Math.max(500, current.dailyBudget - body.amount);
  }
  if (typeof body.dailyBudget === "number") updates.dailyBudget = body.dailyBudget;
  if (typeof body.targetCpl === "number") updates.targetCpl = body.targetCpl;
  if (typeof body.name === "string") updates.name = body.name;

  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No valid updates" }, { status: 400 });

  updates.updatedAt = new Date();
  await db.update(campaigns).set(updates).where(eq(campaigns.id, params.id));
  return NextResponse.json({ ok: true });
}

/**
 * Delete a campaign.
 *
 * Two distinct things can be deleted and conflating them is how people end up
 * with a campaign that is gone from the dashboard and still spending:
 *
 *   - the row in THIS platform, always;
 *   - the campaign in the AD ACCOUNT, only when `deleteInMeta` is asked for,
 *     live mode is on, and the id is a Meta id rather than a local one.
 *
 * The response says plainly which of the two happened, because "deleted"
 * without that distinction is the least useful word available.
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireEditor();
  if (error) return error;

  const url = new URL(req.url);
  const deleteInMeta = url.searchParams.get("deleteInMeta") === "true";

  const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.id, params.id) });
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  // A local id is prefixed (`camp_…`); a published one is Meta's numeric id.
  const looksLikeMetaId = /^\d{6,}$/.test(params.id);
  const liveReady =
    process.env.USE_MOCK_META === "false" && Boolean(process.env.META_ACCESS_TOKEN?.trim());

  let metaDeleted = false;
  let metaNote: string | null = null;

  if (deleteInMeta) {
    if (!looksLikeMetaId) {
      metaNote = "This campaign was never published, so there is nothing in the ad account to delete.";
    } else if (!liveReady) {
      metaNote = "Live mode is off, so the campaign in the ad account was left alone.";
    } else {
      try {
        // Deleting the campaign removes its ad sets and ads with it.
        await graphDelete(params.id);
        metaDeleted = true;
      } catch (err) {
        // A failure here must NOT silently proceed to delete the local row —
        // that would hide a live campaign from the only screen that shows it.
        return NextResponse.json(
          {
            error: `Could not delete this campaign in Meta, so nothing was removed here either. ${
              err instanceof GraphError ? err.describe() : String(err)
            }`,
          },
          { status: 502 }
        );
      }
    }
  } else if (looksLikeMetaId && liveReady) {
    metaNote =
      "Removed from this platform only. The campaign still exists in the ad account — pause or delete it there.";
  }

  // --- local rows, children first ------------------------------------------
  const cityLinks = await db.select().from(campaignCities).where(eq(campaignCities.campaignId, params.id));
  await db.delete(leads).where(eq(leads.campaignId, params.id));
  await db.delete(recommendations).where(eq(recommendations.campaignId, params.id));
  await db.delete(adSets).where(eq(adSets.campaignId, params.id));
  await db.delete(campaignCities).where(eq(campaignCities.campaignId, params.id));
  await db.delete(campaigns).where(eq(campaigns.id, params.id));

  // A city created solely for this campaign goes with it. One that carries
  // other campaigns stays — deleting it would take those down too.
  const removedCities: string[] = [];
  for (const link of cityLinks) {
    const others = await db.select().from(campaignCities).where(eq(campaignCities.cityId, link.cityId));
    if (others.length > 0) continue;
    const city = await db.query.cities.findFirst({ where: eq(cities.id, link.cityId) });
    if (!city) continue;
    await db.delete(alerts).where(eq(alerts.cityId, link.cityId));
    await db.delete(recommendations).where(eq(recommendations.cityId, link.cityId));
    await db.delete(leads).where(eq(leads.cityId, link.cityId));
    await db.delete(adSets).where(eq(adSets.cityId, link.cityId));
    await db.delete(cities).where(eq(cities.id, link.cityId));
    removedCities.push(city.name);
  }

  return NextResponse.json({
    ok: true,
    deletedLocally: true,
    metaDeleted,
    metaNote,
    removedCities,
    name: campaign.name,
  });
}
