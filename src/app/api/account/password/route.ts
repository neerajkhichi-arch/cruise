import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { requireSession } from "@/lib/api-auth";
import { checkPassword } from "@/lib/password";

/**
 * Changing your own password.
 *
 * Separate from the admin route on purpose. This one needs no elevated role —
 * anybody may change their own — but it DOES require the current password,
 * which the admin route does not and should not. That check is what stops an
 * unattended logged-in laptop from becoming a permanent account takeover.
 */
export async function POST(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  const { currentPassword, newPassword } = (await req.json()) as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Both your current and new password are required." }, { status: 400 });
  }

  const me = await db.query.users.findFirst({ where: eq(users.id, session!.user.id) });
  if (!me) return NextResponse.json({ error: "Your account no longer exists." }, { status: 404 });

  const valid = await bcrypt.compare(currentPassword, me.passwordHash);
  if (!valid) {
    // Deliberately not "that password is wrong" versus anything else — this
    // endpoint should not help someone probe an account they are sitting in
    // front of.
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });
  }

  const verdict = checkPassword(newPassword, me.email);
  if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 422 });

  if (await bcrypt.compare(newPassword, me.passwordHash)) {
    return NextResponse.json({ error: "That is the password you already have." }, { status: 422 });
  }

  await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(newPassword, 12) })
    .where(eq(users.id, me.id));

  return NextResponse.json({
    ok: true,
    // Said plainly rather than implied. Sessions are JWTs here, so changing a
    // password does not invalidate one that is already issued — including one
    // on a device you no longer have.
    note:
      "Password changed. Sessions already signed in elsewhere are not signed out — if you are changing this because " +
      "someone else may have had the old password, sign out of other devices as well.",
  });
}
