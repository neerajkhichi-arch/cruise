/**
 * A small TTL cache in front of Meta reads.
 *
 * Written after hitting "Ad account has too many API calls" (code 17,
 * subcode 2446079) within minutes of the Campaigns page going live. The cause
 * was not volume of users — it was one person typing in a search box, where
 * every keystroke re-fetched every campaign, every ad set (paginated) and every
 * insight row. Meta rate-limits per ad account, so one careless screen can lock
 * out the whole account for everyone, including the publish path.
 *
 * Two TTLs, because the two kinds of read age differently:
 *   - STRUCTURE (campaigns, ad sets, targeting) changes when somebody edits a
 *     campaign. Minutes-stale is fine.
 *   - INSIGHTS change continuously but Meta itself aggregates on a delay, so a
 *     minute of staleness is invisible and saves most of the calls.
 *
 * In-process and per-server. That is the right size for this app — a dev server
 * or a single node. A second instance would need something shared, and this
 * comment is here so that is a decision rather than a surprise.
 */

interface Entry<T> {
  value: T;
  expires: number;
}

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

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as T;

  // Collapse concurrent misses onto one request. Without this, a page that
  // fires three fetches at mount triples the call count on a cold cache.
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const p = load()
    .then((value) => {
      store.set(key, { value, expires: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, p);
  return p;
}

/** Drop cached reads — call after a write, so the screen shows what you did. */
export function invalidate(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
