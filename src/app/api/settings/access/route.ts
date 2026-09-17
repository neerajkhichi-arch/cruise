import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { grantAccess, listAllAccounts, listGrants, revokeAccess } from "@/lib/accounts";

/**
 * Who may see which ad account.
 *
 * Admin only, and deliberately separate from the user list: adding a person and
 * deciding what they can see are different decisions, and a single screen that
 * does both tends to end with everyone getting everything because it was the
 * path of least resistance.
 *
 * Admins are shown but not editable. Their access is their role, not a grant,
 * and rows implying otherwise would suggest an admin could be locked out of an
 * account by removing one.
 */

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const [people, accounts, grants] = await Promise.all([
    db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users),
    listAllAccounts(),
    listGrants(),
  ]);

  return NextResponse.json({
    users: people,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, clientName: a.clientName })),
    grants,
  });
}

interface Body {
  userId: string;
  accountId: string;
  /** "none" revokes, "view" grants read-only, "edit" grants read and write. */
  level: "none" | "view" | "edit";
}

export async function POST(req: Request) {
  const { session, error } = await requireAdmin();
  if (error) return error;

  const { userId, accountId, level } = (await req.json()) as Body;
  if (!userId || !accountId) {
    return NextResponse.json({ error: "A user and an account are both required." }, { status: 400 });
  }

  const target = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, userId) });
  if (!target) return NextResponse.json({ error: "That user no longer exists." }, { status: 404 });
  if (target.role === "ADMIN") {
    return NextResponse.json(
      {
        error:
          "Admins already have every account, by role rather than by grant. Change their role first if they should " +
          "only see some accounts.",
      },
      { status: 422 }
    );
  }

  if (level === "none") await revokeAccess(userId, accountId);
  else
    await grantAccess({
      userId,
      accountId,
      canEdit: level === "edit",
      grantedById: session.user.id,
    });

  return NextResponse.json({ grants: await listGrants() });
}
