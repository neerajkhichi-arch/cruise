/**
 * Finding or creating the product set a campaign needs.
 *
 * Extracted so the consolidated-campaign path can use it without calling this
 * app's own HTTP endpoint from inside a route handler. A server route fetching
 * its own API has to reconstruct its base URL and forward cookies, and it fails
 * in a different way in every environment — for a piece of logic that is thirty
 * lines, that is a bad trade.
 *
 * Reuse before create, matching on the FILTER rather than the name. The
 * catalogue's sets are named inconsistently ("Mohali catalog", "Gurgaon
 * Catalogue", "Nashik Catalogue") but the filter is exact, and two sets on the
 * same filter are two things to keep in step that immediately drift apart.
 */

import { graphGet, graphPost } from "./graph";
import { multiCityFilterRule } from "../../../scripts/real-catalogue-data";

export interface EnsuredProductSet {
  productSetId: string;
  name: string;
  productCount: number;
  filterRule: string;
  reused: boolean;
}

/** Normalise a set's filter so `eq` and `is_any` forms compare reliably. */
function normaliseFilter(raw: string): string {
  try {
    const f = JSON.parse(raw) as { city?: { eq?: string; is_any?: string[] } };
    if (typeof f.city?.eq === "string") return `eq:${f.city.eq.toLowerCase()}`;
    if (Array.isArray(f.city?.is_any)) {
      return `any:${f.city.is_any.map((c) => String(c).toLowerCase()).sort().join(",")}`;
    }
  } catch {
    /* an unreadable filter simply never matches */
  }
  return "";
}

export async function ensureProductSet(
  catalogueId: string,
  cityNames: string[]
): Promise<EnsuredProductSet> {
  const cities = cityNames.map((c) => c.trim()).filter(Boolean);
  if (cities.length === 0) throw new Error("At least one city is needed to build a product set.");

  const filter = multiCityFilterRule(cities);
  const wanted = normaliseFilter(filter);

  const sets = await graphGet<{
    data: { id: string; name: string; product_count?: number; filter?: string }[];
  }>(`${catalogueId}/product_sets`, { fields: "id,name,product_count,filter", limit: "100" });

  const existing = sets.data?.find((s) => s.filter && normaliseFilter(s.filter) === wanted);
  if (existing) {
    return {
      productSetId: existing.id,
      name: existing.name,
      productCount: existing.product_count ?? 0,
      filterRule: filter,
      reused: true,
    };
  }

  // Count before creating. Meta refuses an empty set with wording that sounds
  // like a quota rule; what it actually means is that this catalogue holds no
  // vehicles for these cities, and the fix is inventory, not permissions.
  const probe = await graphGet<{ summary?: { total_count: number } }>(`${catalogueId}/products`, {
    filter,
    summary: "total_count",
    limit: "1",
  });
  const available = probe.summary?.total_count ?? 0;
  if (available === 0) {
    throw new Error(
      `${cities.join(" + ")} ${cities.length === 1 ? "has" : "have"} no vehicles in this catalogue, so there is nothing to advertise. ` +
        `The filter ${filter} matches 0 products — an inventory gap, not a permissions problem.`
    );
  }

  const name = cities.length === 1 ? `${cities[0]} Catalogue` : `${cities.join(" + ")} Catalogue`;
  const created = await graphPost<{ id: string }>(`${catalogueId}/product_sets`, { name, filter });

  // Read the count back rather than trusting the probe — a set matching eleven
  // vehicles is worth seeing before the campaign launches, not after.
  const detail = await graphGet<{ id: string; name: string; product_count?: number }>(created.id, {
    fields: "id,name,product_count",
  });

  return {
    productSetId: detail.id,
    name: detail.name ?? name,
    productCount: detail.product_count ?? 0,
    filterRule: filter,
    reused: false,
  };
}
