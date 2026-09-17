import { NextResponse } from "next/server";
import { requireEditor, requireSession, viewerOf } from "@/lib/api-auth";
import { graphGet, GraphError } from "@/lib/meta/graph";
import {
  ACCOUNT_COOKIE,
  listAccounts,
  listAllAccounts,
  removeAccount,
  resolveAccount,
  setDefaultAccount,
  upsertAccount,
} from "@/lib/accounts";

/**
 * The ad accounts Cruise is connected to, and the ones it could be.
 *
 * `available` comes from Meta and is the list the TOKEN can see. That is not
 * the same as the list this system user can USE: an account appears here as
 * soon as the person who made the token can see it, but reading it needs the
 * account assigned to the system user in Business Settings. Rather than let
 * that fail later with a permissions error, each candidate is probed and the
 * ones that are not reachable are returned with the reason.
 */

const describe = (err: unknown) =>
  err instanceof GraphError ? err.describe() : err instanceof Error ? err.message : String(err);

interface RawAccount {
  account_id?: string;
  id?: string;
  name?: string;
  account_status?: number;
  business?: { id?: string; name?: string };
  currency?: string;
  /** What THIS token may do here: MANAGE, ADVERTISE, ANALYZE, DRAFT. */
  user_tasks?: string[];
}

/**
 * What the token can actually do with an account, in plain words.
 *
 * Being able to READ an account is not the same as being able to publish into
 * it, and the difference does not appear until a launch fails. ANALYZE alone is
 * a reporting-only assignment — every screen in Cruise works, and every write
 * is refused. Worth knowing on the settings page rather than at the moment a
 * campaign is meant to go live.
 */
function describeAccess(tasks: string[] | undefined): { canPublish: boolean; access: string } {
  const t = new Set((tasks ?? []).map((x) => x.toUpperCase()));
  if (t.has("MANAGE")) return { canPublish: true, access: "Full control" };
  if (t.has("ADVERTISE")) return { canPublish: true, access: "Can publish and pause" };
  if (t.has("DRAFT")) return { canPublish: false, access: "Drafts only — cannot publish" };
  if (t.has("ANALYZE")) return { canPublish: false, access: "Reporting only — cannot publish" };
  return { canPublish: false, access: "No stated permission" };
}

export async function GET(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  const viewer = viewerOf(session);
  const connected = await listAccounts(viewer);
  const selected = await resolveAccount(req, viewer);

  // The switcher in the top bar needs only the connected list and which one is
  // selected — both of which are local. It mounts on every screen, so letting
  // it fall through to `me/adaccounts` would put a Graph call behind every
  // page load in the app. That is how the last rate-limit lockout happened.
  if (new URL(req.url).searchParams.get("connectedOnly") === "1") {
    return NextResponse.json({ connected, selected, available: [] });
  }

  if (process.env.USE_MOCK_META !== "false" || !process.env.META_ACCESS_TOKEN?.trim()) {
    return NextResponse.json({
      connected,
      selected,
      available: [],
      error: "Live mode is off, so the list of ad accounts cannot be read from Meta.",
    });
  }

  try {
    const body = await graphGet<{ data: RawAccount[] }>("me/adaccounts", {
      fields: "account_id,name,account_status,currency,business,user_tasks",
      limit: "200",
    });
    const already = new Set(connected.map((a) => a.id));
    const rows = body.data ?? [];

    const available = rows
      .map((a) => ({
        id: a.account_id ?? (a.id ?? "").replace(/^act_/, ""),
        name: a.name ?? a.account_id ?? "(unnamed)",
        businessName: a.business?.name ?? null,
        currency: a.currency ?? null,
        // 1 = active. Anything else cannot spend, so it is listed but marked.
        active: a.account_status === 1,
        connected: already.has(a.account_id ?? ""),
        ...describeAccess(a.user_tasks),
      }))
      .sort((x, y) => Number(y.active) - Number(x.active) || x.name.localeCompare(y.name));

    // The same reading, for the accounts already connected. An account Cruise
    // has on file that the token can no longer see is the important case: the
    // screens keep working off stored settings while every Meta call fails, so
    // it is called out rather than left to be discovered.
    const byId = new Map(rows.map((a) => [a.account_id ?? (a.id ?? "").replace(/^act_/, ""), a]));
    const access = Object.fromEntries(
      connected.map((c) => {
        const raw = byId.get(c.id);
        return [
          c.id,
          raw
            ? { reachable: true, ...describeAccess(raw.user_tasks) }
            : {
                reachable: false,
                canPublish: false,
                access:
                  "This token can no longer see this account. Reassign it to the system user in Business Settings, " +
                  "or remove it here — until then every Meta read and write for it will fail.",
              },
        ];
      })
    );

    return NextResponse.json({ connected, selected, available, access });
  } catch (err) {
    return NextResponse.json({ connected, selected, available: [], error: describe(err) });
  }
}

interface SaveBody {
  id: string;
  name?: string;
  businessName?: string | null;
  catalogueId?: string | null;
  conversionEvent?: string | null;
  leadTargetsCsvUrl?: string | null;
  maxDailyBudget?: number | null;
  makeDefault?: boolean;
  /** Set this account as the one the browser is looking at. */
  select?: boolean;
}

export async function POST(req: Request) {
  const { session, error } = await requireEditor();
  if (error) return error;

  const body = (await req.json()) as SaveBody;
  const id = body.id?.replace(/^act_/, "").trim();
  if (!id) return NextResponse.json({ error: "An ad account id is required." }, { status: 400 });

  // Prove the token can actually read it before recording it as connected.
  //
  // Without this, an account added here looks fine until the first screen
  // loads and fails with a permissions error that names nothing useful. The
  // real cause is almost always that it has not been assigned to the system
  // user in Business Settings, so that is what the message says.
  let name = body.name?.trim() || id;
  if (process.env.USE_MOCK_META === "false" && process.env.META_ACCESS_TOKEN?.trim()) {
    try {
      const probe = await graphGet<{ name?: string; account_id?: string }>(`act_${id}`, {
        fields: "account_id,name",
      });
      name = body.name?.trim() || probe.name || id;
    } catch (err) {
      return NextResponse.json(
        {
          error:
            `This token cannot read ad account ${id}. ${describe(err)} ` +
            `Assign the account to the system user in Business Settings → Users → System users → ` +
            `your system user → Add assets → Ad accounts, then add it here again.`,
        },
        { status: 403 }
      );
    }
  }

  const saved = await upsertAccount({ ...body, id, name });
  const res = NextResponse.json({ account: saved, connected: await listAccounts(viewerOf(session)) });
  if (body.select) {
    res.cookies.set(ACCOUNT_COOKIE, saved.id, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  }
  return res;
}

/** Switch which account the browser is looking at, or set the default. */
export async function PATCH(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  const { id, makeDefault } = (await req.json()) as { id: string; makeDefault?: boolean };
  const account = (await listAccounts(viewerOf(session))).find((a) => a.id === id?.replace(/^act_/, ""));
  if (!account) return NextResponse.json({ error: "That account is not connected." }, { status: 404 });

  if (makeDefault) await setDefaultAccount(account.id);
  const res = NextResponse.json({ selected: account, connected: await listAccounts(viewerOf(session)) });
  res.cookies.set(ACCOUNT_COOKIE, account.id, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  return res;
}

export async function DELETE(req: Request) {
  const { session, error } = await requireEditor();
  if (error) return error;

  const id = new URL(req.url).searchParams.get("id")?.replace(/^act_/, "");
  if (!id) return NextResponse.json({ error: "Which account?" }, { status: 400 });
  if ((await listAllAccounts()).length <= 1) {
    return NextResponse.json(
      { error: "This is the only connected account. Add another before removing it." },
      { status: 422 }
    );
  }

  await removeAccount(id);
  return NextResponse.json({
    connected: await listAccounts(viewerOf(session)),
    note: "Removed from Cruise only. Nothing in Meta was changed — the campaigns, spend and history are untouched, and it can be added back at any time.",
  });
}
