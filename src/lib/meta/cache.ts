/**
 * A TTL cache in front of Meta reads, shared by every instance.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Written after hitting "Ad account has too many API calls" (code 17,
 * subcode 2446079) within minutes of the Campaigns page going live. The cause
 * was not volume of users — it was one person typing in a search box, where
 * every keystroke re-fetched every campaign, every ad set (paginated) and every
 * insight row. Meta rate-limits per ad account, so one careless screen can lock
 * out the whole account for everyone, including the publish path.
 *
 * WHY IT IS IN THE DATABASE
 *
 * The first version kept everything in a Map, in the process, with a comment
 * saying that was "the right size for this app — a dev server or a single
 * node". That stopped being true the day this deployed to Vercel, and the
 * comment did not.
 *
 * On Vercel a request can land on an instance that has never seen this account.
 * Its map is empty, so it pays full price: three paginated sweeps of a large ad
 * account. Instances are created and discarded constantly and concurrent
 * requests fan out across them, so a five-minute TTL was, very often, zero —
 * and a reload of the Campaigns screen cost as much as the first load ever did.
 * Media Sales spent days inside its own rate limit for this reason while the
 * code looked careful.
 *
 * It is the same mistake the rate-limit breaker had, in the layer whose entire
 * job is to stop that breaker from being needed.
 *
 * SO: two tiers. The Map stays as an L1, because an instance that just read
 * something should not go to Postgres to read it again. Behind it sits one row
 * per key that every instance can see. A cache read costs one indexed query
 * instead of several paginated Graph calls, and the TTLs now mean what they say.
 *
 * WHAT HAPPENS WHEN POSTGRES IS UNREACHABLE
 *
 * The app calls Meta. A cache is an optimisation; a failure to read it must
 * degrade to being slow and expensive, never to being broken. Every database
 * call here is wrapped and swallowed for that reason.
 * ---------------------------------------------------------------------------
 */

import { eq, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { metaCache } from "../db/schema";

interface Entry<T> {
  value: T;
  expires: number;
}

/** L1: this instance's own copy, in front of the shared row. */
const store = new Map<string, Entry<unknown>>();
/** In-flight requests, so ten simultaneous callers make one call, not ten. */
const inflight = new Map<string, Promise<unknown>>();

export const TTL = {
  /** Campaigns, ad sets, targeting — edited by hand, rarely. */
  structure: 5 * 60 * 1000,
  /** Spend and conversions — Meta aggregates on a delay anyway. */
  insights: 60 * 1000,
  /**
   * Catalogue contents and custom audiences — these change when a feed uploads
   * or somebody builds an audience, which is hours apart, not minutes. They
   * were sharing the five-minute structure TTL and are the most expensive reads
   * in the app, so they get their own.
   */
  catalogue: 30 * 60 * 1000,
} as const;

/**
 * The largest payload worth storing, in characters of JSON.
 *
 * A very large account's ad-set sweep can run to several megabytes. Postgres
 * will take it, but a row that size costs more to move than the call it saves,
 * and it would be written on every miss. Above this the in-process copy still
 * applies — the shared tier simply declines, which is a slower cache, not a
 * broken one.
 */
const MAX_SHARED_CHARS = 4_000_000;

/** The ad account a key belongs to, by the convention every key here follows. */
function accountFromKey(key: string): string | null {
  // Keys look like `adsets-all:act_123` or `insights:campaign:act_123:from:to`.
  const match = key.match(/\bact_\d+/);
  return match ? match[0] : null;
}

async function readShared<T>(key: string, now: number): Promise<Entry<T> | undefined> {
  try {
    const rows = await db
      .select({ value: metaCache.value, expiresAt: metaCache.expiresAt })
      .from(metaCache)
      .where(eq(metaCache.key, key))
      .limit(1);
    const row = rows[0];
    if (!row || row.expiresAt.getTime() <= now) return undefined;
    return { value: JSON.parse(row.value) as T, expires: row.expiresAt.getTime() };
  } catch {
    // An unreadable or unparseable row is a miss, not a failure. Whatever is
    // wrong with it, calling Meta still produces the right answer.
    return undefined;
  }
}

async function writeShared(key: string, value: unknown, expires: number): Promise<void> {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return; // not serialisable; the L1 copy is still good
  }
  if (encoded.length > MAX_SHARED_CHARS) return;

  try {
    await db
      .insert(metaCache)
      .values({
        key,
        accountId: accountFromKey(key),
        value: encoded,
        expiresAt: new Date(expires),
        writtenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: metaCache.key,
        // Last writer wins. Two instances racing on a miss are writing the same
        // answer to the same question, so there is nothing to reconcile.
        set: { value: encoded, expiresAt: new Date(expires), writtenAt: new Date() },
      });
  } catch {
    /* see the header: a cache that cannot be written is slow, not broken */
  }
}

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as T;

  // Collapse concurrent misses onto one request. Without this, a page that
  // fires three fetches at mount triples the call count on a cold cache.
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const p = (async () => {
    // The shared tier, before Meta. This is the whole point: a cold instance
    // should inherit what a warm one already paid for, rather than re-paying.
    const shared = await readShared<T>(key, now);
    if (shared) {
      store.set(key, shared);
      return shared.value;
    }

    const value = await load();
    const expires = Date.now() + ttlMs;
    store.set(key, { value, expires });
    // AWAITED, not fire-and-forget. A serverless function can be frozen the
    // moment its response is sent, so a floating write here often never reaches
    // Postgres — which would leave this exactly as useless as the Map it
    // replaced, while appearing to work in development.
    await writeShared(key, value, expires);
    return value;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, p);
  return p;
}

/**
 * Drop cached reads — call after a write, so the screen shows what you did.
 *
 * Both tiers, and the shared one first: dropping only this instance's copy
 * would let the next request read the stale row back and re-seed the Map with
 * it, so a publish would appear not to have happened.
 *
 * Fire-and-forget is not an option here for the same freeze reason, so this is
 * async and callers await it.
 */
export async function invalidate(prefix: string): Promise<void> {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  try {
    await db.delete(metaCache).where(sql`${metaCache.key} LIKE ${prefix + "%"}`);
  } catch {
    /* the L1 drop already happened; the shared row expires on its own */
  }
}

/**
 * Delete rows whose TTL has passed.
 *
 * Expired rows are never served — every read checks — so this is housekeeping,
 * not correctness. It runs from the daily sweep rather than on every write,
 * because a delete on the hot path is a cost paid by the request that can least
 * afford it.
 */
export async function purgeExpiredCache(): Promise<number> {
  try {
    const deleted = await db.delete(metaCache).where(lt(metaCache.expiresAt, new Date())).returning({
      key: metaCache.key,
    });
    return deleted.length;
  } catch {
    return 0;
  }
}
