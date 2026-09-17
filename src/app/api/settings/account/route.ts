import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accountSettings, namingConvention } from "@/lib/db/schema";
import { requireSession, requireAdmin } from "@/lib/api-auth";

export async function GET() {
  const { error } = await requireSession();
  if (error) return error;

  const [settings, naming] = await Promise.all([
    db.query.accountSettings.findFirst({ where: eq(accountSettings.id, "singleton") }),
    db.query.namingConvention.findFirst({ where: eq(namingConvention.id, "singleton") }),
  ]);
  return NextResponse.json({ settings, naming });
}

export async function PATCH(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const updates: Partial<typeof accountSettings.$inferInsert> = {};
  for (const key of [
    "companyName",
    "defaultTargetCpl",
    "monthlyBudgetCap",
    "lowInventoryThreshold",
    "oldInventoryDays",
    "avgDealMargin",
    "emailAlerts",
    "slackAlerts",
    "whatsappAlerts",
  ] as const) {
    if (body[key] !== undefined) (updates as any)[key] = body[key];
  }

  if (body.namingTemplate) {
    await db.update(namingConvention).set({ template: body.namingTemplate, updatedAt: new Date() }).where(eq(namingConvention.id, "singleton"));
  }

  if (Object.keys(updates).length > 0) {
    await db.update(accountSettings).set(updates).where(eq(accountSettings.id, "singleton"));
  }

  return NextResponse.json({ ok: true });
}
