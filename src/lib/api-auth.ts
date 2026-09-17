import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canEditAccount, canView, resolveAccount, type MetaAccount, type Viewer } from "@/lib/accounts";
import { enterAccountCredential } from "@/lib/meta/credentials";

export async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session) return { session: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { session, error: null };
}

export async function requireEditor() {
  const { session, error } = await requireSession();
  if (error) return { session: null, error };
  if (session!.user.role === "VIEWER") {
    return { session: null, error: NextResponse.json({ error: "Viewers cannot make changes." }, { status: 403 }) };
  }
  return { session, error: null };
}

export async function requireAdmin() {
  const { session, error } = await requireSession();
  if (error) return { session: null, error };
  if (session!.user.role !== "ADMIN") {
    return { session: null, error: NextResponse.json({ error: "Admin access required." }, { status: 403 }) };
  }
  return { session, error: null };
}

/** The signed-in user as the accounts layer wants them. */
export function viewerOf(session: { user: { id: string; role: string } } | null): Viewer | null {
  if (!session?.user?.id) return null;
  return { id: session.user.id, role: session.user.role as Viewer["role"] };
}

/**
 * The account this request is about, having checked the caller may see it.
 *
 * Every route that reads Meta goes through this rather than resolving an
 * account itself. The account id can arrive in a query string, so a check that
 * lives only in the page that renders the picker is not a check at all — this
 * is the one place where "which account" and "may they?" are decided together,
 * and the two cannot drift apart.
 */
export async function requireAccount(req: Request): Promise<
  | { account: MetaAccount; session: NonNullable<Awaited<ReturnType<typeof requireSession>>["session"]>; error: null }
  | { account: null; session: null; error: NextResponse }
> {
  const { session, error } = await requireSession();
  if (error) return { account: null, session: null, error };

  const viewer = viewerOf(session);
  const account = await resolveAccount(req, viewer);
  if (!account) {
    return {
      account: null,
      session: null,
      error: NextResponse.json(
        {
          error:
            "No ad account is available to you. An admin has to connect one and grant you access to it in Settings → Ad accounts.",
        },
        { status: 403 }
      ),
    };
  }

  // resolveAccount only ever returns accounts the viewer may see, so this is a
  // belt-and-braces check. It stays because the cost is one indexed row and the
  // failure it guards against is one client seeing another's spend.
  if (!(await canView(viewer, account.id))) {
    return {
      account: null,
      session: null,
      error: NextResponse.json({ error: "You do not have access to that ad account." }, { status: 403 }),
    };
  }

  // Make this account's credential the one every Graph call in this request
  // uses. Today that is always the system user token; when an account carries
  // its own, nothing downstream has to change to pick it up.
  await enterAccountCredential(account.id);

  return { account, session: session!, error: null };
}

/**
 * The same, for a route that is about to change something in Meta.
 *
 * Being a MANAGER is not enough on its own: the grant on this specific account
 * has to allow editing. That is what makes a read-only grant on a client's
 * account mean something.
 */
export async function requireAccountEditor(req: Request) {
  const { account, session, error } = await requireAccount(req);
  if (error) return { account: null, session: null, error };

  const viewer = viewerOf(session);
  if (!(await canEditAccount(viewer, account.id))) {
    return {
      account: null,
      session: null,
      error: NextResponse.json(
        {
          error:
            session.user.role === "VIEWER"
              ? "Viewers cannot make changes."
              : `You have read-only access to ${account.name}. An admin can grant editing in Settings → Ad accounts.`,
        },
        { status: 403 }
      ),
    };
  }

  return { account, session, error: null };
}
