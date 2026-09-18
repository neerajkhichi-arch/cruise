import { AsyncLocalStorage } from "async_hooks";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { metaAccounts } from "../db/schema";
import { decryptSecret } from "../crypto";

/**
 * Which token this request should use.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Every Graph call read META_ACCESS_TOKEN directly. One install, one system
 * user, one token — true today, and it stops being true the moment a client
 * authorises Cruise themselves rather than assigning an account to Girnar's
 * system user. At that point the token depends on WHICH ACCOUNT the call is
 * about, and a global cannot express that.
 *
 * Rewriting a hundred call sites to thread a token through would be the
 * expensive way to find that out. Instead the account travels with the request
 * in async-local storage, and `currentToken()` stays synchronous, so nothing
 * downstream changes shape.
 *
 * TODAY'S BEHAVIOUR IS UNCHANGED. No account carries its own token yet, so
 * every call falls back to the system user token in the environment. This is
 * the seam, wired and inert — not a new way of doing things nobody has tested.
 * ---------------------------------------------------------------------------
 */

interface MetaContext {
  accountId: string;
  /**
   * The token belonging to THIS account, or null to fall back to the system
   * user's at the moment of the call.
   *
   * Null rather than eagerly resolving the system token, because resolving it
   * eagerly means demanding it eagerly: an install with no Meta credentials yet
   * — mock mode, a fresh deploy, a developer who has not pasted a token —
   * would then throw on every authenticated request rather than on the screens
   * that actually talk to Meta. That regression shipped for about ten minutes
   * and turned every page into a 500.
   */
  token: string | null;
  /** False when this account has no token of its own. */
  perAccount: boolean;
  /**
   * The pixel event THIS account counts as a lead. Null falls back to
   * META_CONVERSION_EVENT.
   *
   * It rides along with the token for the same reason the token does: which
   * event means "a lead" is a property of the ad account, not of the install.
   * `meta_accounts.conversion_event` has been settable in Settings -> Ad
   * accounts since the Postgres port, but nothing on any screen read it - every
   * account was counted against the single environment value, which is the Used
   * Car pixel event. BikeDekho, Trucks Dekho and the Media Sales accounts
   * therefore reported spend, impressions and clicks correctly and zero leads,
   * which reads as a bad month rather than as a misconfiguration.
   */
  conversionEvent: string | null;
}

const storage = new AsyncLocalStorage<MetaContext>();

function systemUserToken(): string {
  const t = process.env.META_ACCESS_TOKEN?.trim();
  if (!t) {
    throw new Error(
      "META_ACCESS_TOKEN is not set. Live publishing needs a system user token with ads_management on the ad account."
    );
  }
  return t;
}

/**
 * Load the credential for an account.
 *
 * A stored token that will not decrypt is a hard error rather than a quiet
 * fallback to the system user's: falling back would mean acting on a client's
 * account with Girnar's credentials, which is the sort of thing that is fine
 * right up until it is a serious problem.
 */
export async function credentialFor(accountId: string): Promise<MetaContext> {
  const rows = await db
    .select({
      token: metaAccounts.accessTokenEncrypted,
      expires: metaAccounts.tokenExpiresAt,
      conversionEvent: metaAccounts.conversionEvent,
    })
    .from(metaAccounts)
    .where(eq(metaAccounts.id, accountId))
    .limit(1);

  // Read once, whichever branch we take below. An account with no token of its
  // own still has its own lead event, and the early return used to drop it.
  const conversionEvent = rows[0]?.conversionEvent?.trim() || null;

  const stored = rows[0]?.token;
  if (!stored) return { accountId, token: null, perAccount: false, conversionEvent };

  const expires = rows[0]?.expires;
  if (expires && expires.getTime() < Date.now()) {
    throw new Error(
      `The stored access token for ad account ${accountId} expired on ${expires.toISOString().slice(0, 10)}. ` +
        `It has to be re-authorised before Cruise can read or change anything in that account.`
    );
  }

  return { accountId, token: decryptSecret(stored), perAccount: true, conversionEvent };
}

/**
 * Run `fn` with this account's credential active.
 *
 * The explicit form, for background work — the auto-pause sweep runs outside
 * any request and iterates several accounts, so it must set the context per
 * account rather than inherit one.
 */
export async function withAccountCredential<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
  const ctx = await credentialFor(accountId);
  return storage.run(ctx, fn);
}

/**
 * Set the credential for the rest of THIS async context.
 *
 * `enterWith` rather than `run` so that a route handler does not have to wrap
 * its whole body in a callback just to say which account it is about. Each
 * request handler runs in its own async context, so this does not leak between
 * concurrent requests — but it is the reason background jobs use the callback
 * form above, where there is no such guarantee.
 */
export async function enterAccountCredential(accountId: string): Promise<void> {
  storage.enterWith(await credentialFor(accountId));
}

/**
 * The token for the call about to be made. Synchronous by design.
 *
 * This is where a missing token becomes an error — at the point something
 * actually needs one, not when an account is merely identified.
 */
export function currentToken(): string {
  return storage.getStore()?.token ?? systemUserToken();
}

/** Which account the current call is about, when anything is set. */
export function currentAccountId(): string | null {
  return storage.getStore()?.accountId ?? null;
}

/**
 * The pixel event the current account counts as a lead.
 *
 * Synchronous, like `currentToken()`, so the four reporting modules that ask
 * for it do not have to become async or thread an account through. Null when
 * no context is set or the account has not been given one - the caller falls
 * back to the environment value, which is what every account used to do.
 */
export function currentConversionEvent(): string | null {
  return storage.getStore()?.conversionEvent ?? null;
}
