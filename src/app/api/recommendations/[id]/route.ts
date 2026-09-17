import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { recommendations, campaigns, cities } from "@/lib/db/schema";
import { requireEditor } from "@/lib/api-auth";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { session, error } = await requireEditor();
  if (error) return error;

  const body = await req.json();
  const status: "APPROVED" | "REJECTED" = body.status;
  if (status !== "APPROVED" && status !== "REJECTED") {
    return NextResponse.json({ error: "status must be APPROVED or REJECTED" }, { status: 400 });
  }

  const rec = await db.query.recommendations.findFirst({ where: eq(recommendations.id, params.id) });
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .update(recommendations)
    .set({ status, resolvedAt: new Date(), resolvedById: session!.user.id })
    .where(eq(recommendations.id, params.id));

  // Approving a budget-shaped recommendation actually moves the number.
  if (status === "APPROVED" && rec.suggestedDailyBudget != null) {
    if (rec.scope === "CAMPAIGN" && rec.campaignId) {
      await db.update(campaigns).set({ dailyBudget: rec.suggestedDailyBudget, updatedAt: new Date() }).where(eq(campaigns.id, rec.campaignId));
    } else if (rec.scope === "CITY" && rec.cityId) {
      await db.update(cities).set({ dailyBudget: rec.suggestedDailyBudget, recommendedBudget: rec.suggestedDailyBudget }).where(eq(cities.id, rec.cityId));
    }
  }

  return NextResponse.json({ ok: true });
}
