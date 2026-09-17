import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { optimisationRules } from "@/lib/db/schema";
import { requireSession, requireAdmin } from "@/lib/api-auth";

export async function GET() {
  const { error } = await requireSession();
  if (error) return error;

  const rows = await db.select().from(optimisationRules);
  return NextResponse.json({
    rules: rows.map((r) => ({ ...r, params: JSON.parse(r.params) })),
  });
}

export async function PATCH(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const { id, enabled, params } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const updates: Partial<typeof optimisationRules.$inferInsert> = { updatedAt: new Date() };
  if (typeof enabled === "boolean") updates.enabled = enabled;
  if (params) updates.params = JSON.stringify(params);

  await db.update(optimisationRules).set(updates).where(eq(optimisationRules.id, id));
  return NextResponse.json({ ok: true });
}
