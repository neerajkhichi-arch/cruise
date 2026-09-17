import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/api-auth";
import { checkPassword, generatePassword } from "@/lib/password";

/**
 * Changing one user: their role, or their password.
 *
 * The password half is new. Before this, Cruise had no way to change a password
 * anywhere — not an admin resetting someone else's, not a person changing their
 * own — so every account was stuck on whatever it was created with, and what it
 * was created with was the same hardcoded string for everybody.
 */

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { session, error } = await requireAdmin();
  if (error) return error;

  const body = (await req.json()) as { role?: string; password?: string; resetPassword?: boolean };

  const target = await db.query.users.findFirst({ where: eq(users.id, params.id) });
  if (!target) return NextResponse.json({ error: "That user no longer exists." }, { status: 404 });

  // --- password ------------------------------------------------------------
  if (body.password || body.resetPassword) {
    const supplied = typeof body.password === "string" ? body.password.trim() : "";
    if (supplied) {
      const verdict = checkPassword(supplied, target.email);
      if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 422 });
    }
    const next = supplied || generatePassword();
    await db
      .update(users)
      .set({ passwordHash: await bcrypt.hash(next, 12) })
      .where(eq(users.id, params.id));

    return NextResponse.json({
      ok: true,
      // Returned only when Cruise generated it. A password the admin typed is
      // already known to them and does not need echoing back.
      tempPassword: supplied ? null : next,
      note:
        params.id === session!.user.id
          ? "Your password has changed."
          : `${target.name}'s password has changed. Hand it over directly, and have them change it once they are in.`,
    });
  }

  // --- role ----------------------------------------------------------------
  if (!body.role) {
    return NextResponse.json({ error: "Nothing to change — send a role or a password." }, { status: 400 });
  }
  if (params.id === session!.user.id && body.role !== "ADMIN") {
    // Demoting yourself locks you out of the screen you are standing on, and if
    // you are the only admin it locks everyone out of administration for good.
    return NextResponse.json(
      { error: "You cannot remove your own admin role. Ask another admin to do it." },
      { status: 422 }
    );
  }

  await db
    .update(users)
    .set({ role: body.role as "ADMIN" | "MANAGER" | "VIEWER" })
    .where(eq(users.id, params.id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { session, error } = await requireAdmin();
  if (error) return error;
  if (session!.user.id === params.id) {
    return NextResponse.json({ error: "You cannot remove your own account." }, { status: 400 });
  }

  // Refuse to remove the last admin. Without this, deleting the wrong row
  // leaves an install nobody can administer and no way back in through the
  // interface.
  const target = await db.query.users.findFirst({ where: eq(users.id, params.id) });
  if (target?.role === "ADMIN") {
    const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "ADMIN"));
    if (admins.length <= 1) {
      return NextResponse.json({ error: "That is the only admin. Make someone else an admin first." }, { status: 422 });
    }
  }

  await db.delete(users).where(eq(users.id, params.id));
  return NextResponse.json({ ok: true });
}
