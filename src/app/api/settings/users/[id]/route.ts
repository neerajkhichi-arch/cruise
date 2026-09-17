import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/api-auth";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireAdmin();
  if (error) return error;
  const body = await req.json();
  if (!body.role) return NextResponse.json({ error: "role required" }, { status: 400 });

  await db.update(users).set({ role: body.role }).where(eq(users.id, params.id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { session, error } = await requireAdmin();
  if (error) return error;
  if (session!.user.id === params.id) return NextResponse.json({ error: "You cannot remove your own account." }, { status: 400 });

  await db.delete(users).where(eq(users.id, params.id));
  return NextResponse.json({ ok: true });
}
