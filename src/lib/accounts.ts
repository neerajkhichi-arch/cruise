/**
 * The Meta ad accounts this install works with, and who may see them.
 *
 * WHAT CHANGED IN THE POSTGRES PORT
 *
 * Every function here used to be synchronous, reading a local SQLite file. They
 * are all async now. That is not a style change — a database over a network
 * cannot be read synchronously, and pretending otherwise is how a codebase ends
 * up with a blocking call in a request handler.
 *
 * The runtime `CREATE TABLE IF NOT EXISTS` is gone. It existed so that
 * connecting a second account did not require anyone to remember a migration
 * step; on Postgres that trick races two cold starts against each other and the
 * migration step is now automatic anyway.
 *
 * WHAT IS REQUIRED PER ACCOUNT, AND WHAT IS NOT
 *
 * Only the id. Everything else is optional, because the things that vary
 * between accounts either come from Meta at the time they are needed or simply
 * do not apply:
 *
 *   - page and Instagram identity are read off the SOURCE campaign's creative
 *     when publishing, so they never need to be configured here;
 *   - a catalogue id is only meaningful for catalogue campaigns. Most accounts
 *     are not, so it is null and the catalogue screens are hidden for them
 *     rather than showing an empty Vehicles page that looks broken;
 *   - a lead-targets sheet is optional. Without one there is nothing for
 *     auto-pause to enforce, so auto-pause simply does not run for that account
 *     — and says so, rather than appearing to be on and doing nothing.
 *
 * ACCESS
 *
 * An ADMIN sees every account. Everyone else sees only the accounts granted to
 * them in `user_accounts`. The listing functions take a viewer so that the
 * filtering happens in the query rather than in whichever screen remembers to
 * do it — a picker that hides a row is a courtesy, not a control.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "./db/client";
import { metaAccounts, userAccounts } from "./db/schema";
import { ACCOUNT } from "../../scripts/verified-account-facts";

export interface MetaAccount {
  /** Numeric ad account id, without the `act_` prefix. */
  id: string;
  name: string;
  businessName: string | null;
  clientName: string | null;
  /** Catalogue campaigns only. Null means this is not a catalogue account. */
  catalogueId: string | null;
  /** The pixel event counted as a lead. Null falls back to META_CONVERSION_EVENT. */
  conversionEvent: string | null;
  /** Published CSV of monthly lead targets and budgets. Null disables auto-pause. */
  leadTargetsCsvUrl: string | null;
  /** Rupees per day a single campaign may be given. Null falls back to the env cap. */
  maxDailyBudget: number | null;
  isDefault: boolean;
  addedAt: string;
  /** True when this account carries its own token rather than the system user's. */
  hasOwnToken: boolean;
}

/** Who is asking. Null means an unauthenticated or internal caller. */
export interface Viewer {
  id: string;
  role: "ADMIN" | "MANAGER" | "VIEWER";
}

type Row = typeof metaAccounts.$inferSelect;

const toAccount = (r: Row): MetaAccount => ({
  id: r.id,
  name: r.name,
  businessName: r.businessName,
  clientName: r.clientName,
  catalogueId: r.catalogueId,
  conversionEvent: r.conversionEvent,
  leadTargetsCsvUrl: r.leadTargetsCsvUrl,
  maxDailyBudget: r.maxDailyBudget,
  isDefault: r.isDefault,
  addedAt: r.addedAt.toISOString(),
  // The token itself never leaves this module. Callers only ever need to know
  // whether there is one.
  hasOwnToken: Boolean(r.accessTokenEncrypted),
});

/**
 * The account described by .env, as a row.
 *
 * Seeded on first read so an install that has only ever had one account keeps
 * working with no setup at all. The environment stays the source of truth for
 * it — this is a migration, not a takeover.
 *
 * `onConflictDoNothing` rather than a read-then-write: two cold starts can run
 * this at the same moment and only one may win, without either failing.
 */
async function seedFromEnv(): Promise<void> {
  const envId = process.env.META_AD_ACCOUNT_ID?.trim() || ACCOUNT.adAccountId;
  if (!envId) return;
  await db
    .insert(metaAccounts)
    .values({
      id: envId,
      name: ACCOUNT.adAccountName || envId,
      businessName: "CarDekho",
      clientName: "CarDekho",
      catalogueId: process.env.META_CATALOGUE_ID?.trim() || null,
      conversionEvent: process.env.META_CONVERSION_EVENT?.trim() || null,
      leadTargetsCsvUrl: process.env.LEAD_TARGETS_CSV_URL?.trim() || null,
      maxDailyBudget: null,
      isDefault: true,
    })
    .onConflictDoNothing();
}

/** Every connected account, regardless of who is looking. Server-side only. */
export async function listAllAccounts(): Promise<MetaAccount[]> {
  await seedFromEnv();
  const rows = await db
    .select()
    .from(metaAccounts)
    .orderBy(desc(metaAccounts.isDefault), asc(metaAccounts.name));
  return rows.map(toAccount);
}

/**
 * The accounts this viewer may see.
 *
 * An ADMIN sees everything. Everyone else sees what they have been granted —
 * and a user with no grants sees nothing, which is the correct starting state
 * for a new joiner rather than every client's spend.
 */
export async function listAccounts(viewer?: Viewer | null): Promise<MetaAccount[]> {
  if (!viewer || viewer.role === "ADMIN") return listAllAccounts();
  await seedFromEnv();
  const rows = await db
    .select({ account: metaAccounts })
    .from(metaAccounts)
    .innerJoin(userAccounts, eq(userAccounts.accountId, metaAccounts.id))
    .where(eq(userAccounts.userId, viewer.id))
    .orderBy(desc(metaAccounts.isDefault), asc(metaAccounts.name));
  return rows.map((r) => toAccount(r.account));
}

export async function getAccount(id: string): Promise<MetaAccount | null> {
  await seedFromEnv();
  const rows = await db.select().from(metaAccounts).where(eq(metaAccounts.id, id)).limit(1);
  return rows[0] ? toAccount(rows[0]) : null;
}

/** Whether this viewer may see this account at all. */
export async function canView(viewer: Viewer | null | undefined, accountId: string): Promise<boolean> {
  if (!viewer) return false;
  if (viewer.role === "ADMIN") return true;
  const rows = await db
    .select({ userId: userAccounts.userId })
    .from(userAccounts)
    .where(and(eq(userAccounts.userId, viewer.id), eq(userAccounts.accountId, accountId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Whether this viewer may CHANGE anything in this account.
 *
 * Two gates, both of which must pass: the platform role must not be VIEWER, and
 * the grant on this specific account must carry canEdit. A manager with a
 * read-only grant on a client's account can report on it and cannot publish
 * into it, which is the usual shape for a client who wants visibility.
 */
export async function canEditAccount(viewer: Viewer | null | undefined, accountId: string): Promise<boolean> {
  if (!viewer) return false;
  if (viewer.role === "VIEWER") return false;
  if (viewer.role === "ADMIN") return true;
  const rows = await db
    .select({ canEdit: userAccounts.canEdit })
    .from(userAccounts)
    .where(and(eq(userAccounts.userId, viewer.id), eq(userAccounts.accountId, accountId)))
    .limit(1);
  return rows[0]?.canEdit === true;
}

/** Grant or update one person's access to one account. */
export async function grantAccess(input: {
  userId: string;
  accountId: string;
  canEdit: boolean;
  grantedById?: string | null;
}): Promise<void> {
  await db
    .insert(userAccounts)
    .values({
      userId: input.userId,
      accountId: input.accountId,
      canEdit: input.canEdit,
      grantedById: input.grantedById ?? null,
    })
    .onConflictDoUpdate({
      target: [userAccounts.userId, userAccounts.accountId],
      set: { canEdit: input.canEdit, grantedById: input.grantedById ?? null },
    });
}

export async function revokeAccess(userId: string, accountId: string): Promise<void> {
  await db
    .delete(userAccounts)
    .where(and(eq(userAccounts.userId, userId), eq(userAccounts.accountId, accountId)));
}

/** Everyone's grants, for the access screen. */
export async function listGrants(): Promise<{ userId: string; accountId: string; canEdit: boolean }[]> {
  return db
    .select({
      userId: userAccounts.userId,
      accountId: userAccounts.accountId,
      canEdit: userAccounts.canEdit,
    })
    .from(userAccounts);
}

export async function upsertAccount(input: {
  id: string;
  name: string;
  businessName?: string | null;
  clientName?: string | null;
  catalogueId?: string | null;
  conversionEvent?: string | null;
  leadTargetsCsvUrl?: string | null;
  maxDailyBudget?: number | null;
  makeDefault?: boolean;
}): Promise<MetaAccount> {
  await seedFromEnv();
  const id = input.id.replace(/^act_/, "").trim();
  const existing = await getAccount(id);

  await db
    .insert(metaAccounts)
    .values({
      id,
      name: input.name.trim() || id,
      businessName: input.businessName ?? existing?.businessName ?? null,
      clientName: input.clientName ?? existing?.clientName ?? null,
      catalogueId: input.catalogueId?.trim() || null,
      conversionEvent: input.conversionEvent?.trim() || null,
      leadTargetsCsvUrl: input.leadTargetsCsvUrl?.trim() || null,
      maxDailyBudget: input.maxDailyBudget ?? null,
      isDefault: existing?.isDefault ?? false,
    })
    .onConflictDoUpdate({
      target: metaAccounts.id,
      set: {
        name: input.name.trim() || id,
        businessName: input.businessName ?? existing?.businessName ?? null,
        clientName: input.clientName ?? existing?.clientName ?? null,
        catalogueId: input.catalogueId?.trim() || null,
        conversionEvent: input.conversionEvent?.trim() || null,
        leadTargetsCsvUrl: input.leadTargetsCsvUrl?.trim() || null,
        maxDailyBudget: input.maxDailyBudget ?? null,
      },
    });

  if (input.makeDefault) await setDefaultAccount(id);
  return (await getAccount(id))!;
}

export async function setDefaultAccount(id: string): Promise<void> {
  await db.update(metaAccounts).set({ isDefault: false });
  await db.update(metaAccounts).set({ isDefault: true }).where(eq(metaAccounts.id, id));
}

/**
 * Remove an account from Cruise.
 *
 * Removes nothing in Meta — the campaigns, spend and history are untouched and
 * the account can be added back. Worth being explicit about, because "remove"
 * next to a live ad account reads alarmingly.
 */
export async function removeAccount(id: string): Promise<void> {
  await db.delete(metaAccounts).where(eq(metaAccounts.id, id));
  const remaining = await listAllAccounts();
  if (remaining.length > 0 && !remaining.some((a) => a.isDefault)) {
    await setDefaultAccount(remaining[0].id);
  }
}

export const ACCOUNT_COOKIE = "cruise_account";

/** The account id asked for in this request, if any. */
function wantedAccountId(req?: Request): string | null {
  if (!req) return null;
  try {
    const fromQuery = new URL(req.url).searchParams.get("account");
    if (fromQuery) return fromQuery.replace(/^act_/, "");
  } catch {
    /* a relative URL in a test — fall through to the cookie */
  }
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${ACCOUNT_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]).replace(/^act_/, "") : null;
}

/**
 * Which account this request is about.
 *
 * Order: an explicit `?account=` wins, then the cookie the switcher sets, then
 * the default. An id the viewer may not see falls back to one they may — a
 * stale cookie or a hand-edited URL must not be able to point reads, let alone
 * writes, at another client's account.
 */
export async function resolveAccount(req?: Request, viewer?: Viewer | null): Promise<MetaAccount | null> {
  const accounts = await listAccounts(viewer);
  if (accounts.length === 0) return null;

  const wanted = wantedAccountId(req);
  if (wanted) {
    const hit = accounts.find((a) => a.id === wanted);
    if (hit) return hit;
  }
  return accounts.find((a) => a.isDefault) ?? accounts[0];
}

/** The id alone, for the many call sites that want nothing else. */
export async function resolveAccountId(req?: Request, viewer?: Viewer | null): Promise<string> {
  const account = await resolveAccount(req, viewer);
  return account?.id || process.env.META_AD_ACCOUNT_ID?.trim() || ACCOUNT.adAccountId;
}
