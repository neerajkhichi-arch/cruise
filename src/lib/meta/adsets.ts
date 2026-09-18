/**
 * Every ad set in an account, read ONCE.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Three modules paginated the same `/adsets` edge under three different cache
 * keys — `adsets:`, `city-adsets:` and `adsets-geo:` — because each wanted a
 * slightly different field list. The field lists differ; the call does not. An
 * account with several hundred ad sets pages that edge two or three times over,
 * and opening the dashboard fires all three at once, because the dashboard, the
 * budget band and the recommendations each read Meta independently.
 *
 * Multiply that by a reload, and by a second person with the tab open, and the
 * account hits its per-account rate limit — which then blocks publishing too,
 * and stays tripped for as long as anybody keeps reloading.
 *
 * So: one call, the union of the fields, one cache key. The union is barely
 * larger than any single list, and asking for a few extra fields on one request
 * costs far less than making the same request three times.
 *
 * Each caller keeps its own row type and reads the subset it cares about, which
 * is why this is generic rather than owning a shared interface — the shapes
 * they want are compatible subsets of what Meta returns.
 * ---------------------------------------------------------------------------
 */

import { actPath, graphGet } from "./graph";
import { TTL, cached } from "./cache";

/**
 * The union of what the callers ask for.
 *
 * One constant, so a module needing another field adds it here and everyone
 * keeps sharing the single read — rather than quietly starting a fourth sweep
 * of the same edge, which is how this got expensive in the first place.
 */
const FIELDS = [
  "id",
  "name",
  "status",
  "effective_status",
  "campaign_id",
  "daily_budget",
  "optimization_goal",
  "promoted_object",
  "attribution_spec",
  "campaign{id,name,status}",
  "targeting{geo_locations,custom_audiences}",
].join(",");

async function pageAll<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  do {
    const page = await graphGet<{ data: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(path, {
      ...params,
      ...(after ? { after } : {}),
    });
    out.push(...(page.data ?? []));
    after = page.paging?.next ? page.paging?.cursors?.after : undefined;
  } while (after);
  return out;
}

/**
 * All ad sets for an account, shared across every caller.
 *
 * Structure TTL: ad sets change when somebody edits a campaign, so minutes of
 * staleness is invisible — and this is the most expensive read the app makes.
 */
export async function getAllAdSets<T>(adAccountId: string): Promise<T[]> {
  return cached(`adsets-all:${adAccountId}`, TTL.structure, () =>
    pageAll<T>(actPath(adAccountId, "adsets"), { fields: FIELDS, limit: "200" })
  );
}
