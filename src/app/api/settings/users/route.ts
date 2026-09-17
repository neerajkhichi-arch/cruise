import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { newId } from "@/lib/id";
import { requireSession, requireAdmin } from "@/lib/api-auth";
import { checkPassword, generatePassword } from "@/lib/password";

const AVATAR_COLORS = ["#1a73e8", "#1e8e3e", "#e37400", "#9334e6", "#d93025", "#12b5cb"];

export async function GET() {
  const { error } = await requireSession();
  if (error) return error;

  const rows = await db.select().from(users);
  return NextResponse.json({
    users: rows.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, avatarColor: u.avatarColor, createdAt: u.createdAt.toISOString() })),
  });
}

export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const { name, email, role } = body;
  if (!name || !email || !role) return NextResponse.json({ error: "name, email, and role are required" }, { status: 400 });

  const existing = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
  if (existing) return NextResponse.json({ error: "A user with that email already exists." }, { status: 409 });

  // A generated password, not a shared default.
  //
  // This used to hash the literal string "demo1234" for every user it created
  // — the same password the seed script uses and the README documents. An
  // admin may supply one; otherwise a random one is generated and returned
  // ONCE, to be handed over and then changed.
  const supplied = typeof body.password === "string" ? body.password.trim() : "";
  if (supplied) {
    const verdict = checkPassword(supplied, email);
    if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 422 });
  }
  const tempPassword = supplied || generatePassword();
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  const id = newId("usr");
  await db.insert(users).values({
    id,
    name,
    email: email.toLowerCase(),
    role,
    passwordHash,
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
  });

  return NextResponse.json({
    id,
    // Returned once. Cruise stores only the hash, so this cannot be looked up
    // later — a forgotten password is reset, not recovered.
    tempPassword: supplied ? null : tempPassword,
  });
}
