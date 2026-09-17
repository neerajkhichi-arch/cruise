import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { newId } from "@/lib/id";
import { requireSession, requireAdmin } from "@/lib/api-auth";

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

  const passwordHash = await bcrypt.hash("demo1234", 10);
  const id = newId("usr");
  await db.insert(users).values({
    id,
    name,
    email: email.toLowerCase(),
    role,
    passwordHash,
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
  });

  return NextResponse.json({ id, tempPassword: "demo1234" });
}
