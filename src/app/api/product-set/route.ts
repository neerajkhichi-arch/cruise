import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/api-auth";
import { GraphError, graphGet, graphPost } from "@/lib/meta/graph";
import { DEFAULT_CATALOGUE_ID, cityFilterRule, multiCityFilterRule } from "../../../../scripts/real-catalogue-data";

/**
 * Turning Meta's permission errors into the one sentence that fixes them.
 *
 * A catalogue call rejected for permissions returns wording about "the object"
 * and "insufficient permission", which sends an operator hunting through
 * Business Settings. There are only ever two causes, so name both.
 */
function explainCatalogueRefusal(err: unknown, catalogueId: string): string | null {
  if (!(err instanceof GraphError)) return null;
  const permissionCodes = new Set([10, 200, 294, 3, 190]);
  if (!permissionCodes.has(err.code)) return null;
  return (
    `Meta refused this catalogue call. Two things have to be true and one of them is not: ` +
    `(1) catalogue ${catalogueId} is assigned to the system user in Business Settings → Data sources → ` +
    `Catalogues → Add people, with Full control; and (2) the token was generated with ` +
    `catalog_management as well as ads_management. Assigning the catalogue is what makes ` +
    `catalog_management appear in the token generator, so do it in that order. ` +
    `Meta's own wording: ${err.describe()}`
  );
}

/**
 * The city's product set, if the catalogue already holds one.
 *
 * Worth a call before creating anything. The live catalogue already contained a
 * "Gurgaon Catalogue" — created by hand after this endpoint was refused — and
 * creating a second set with an identical filter would have split the same 213
 * vehicles across two sets that then drift apart. Matching is on the FILTER,
 * not the name: "Mohali catalog" and "Gurgaon Catalogue" are named
 * inconsistently, but both filter on `city`.
 */
async function findExistingCitySet(
  catalogueId: string,
  filter: string
): Promise<{ id: string; name: string; product_count?: number; filter?: string } | null> {
  // Compare the whole filter, normalised, rather than just `city.eq`. The
  // single-city version only understood `{city:{eq:"x"}}`, so a multi-city set
  // could never be matched and every consolidated launch would have created a
  // fresh one — the same duplication that left nine identical Gurgaon audiences
  // in this account.
  const norm = (raw: string): string => {
    try {
      const f = JSON.parse(raw) as { city?: { eq?: string; is_any?: string[] } };
      if (typeof f.city?.eq === "string") return `eq:${f.city.eq.toLowerCase()}`;
      if (Array.isArray(f.city?.is_any)) {
        return `any:${[...f.city!.is_any!].map((c) => String(c).toLowerCase()).sort().join(",")}`;
      }
      return "";
    } catch {
      return "";
    }
  };
  const wanted = norm(filter);
  if (!wanted) return null;

  const sets = await graphGet<{
    data: { id: string; name: string; product_count?: number; filter?: string }[];
  }>(`${catalogueId}/product_sets`, { fields: "id,name,product_count,filter", limit: "100" });

  return sets.data?.find((s) => s.filter && norm(s.filter) === wanted) ?? null;
}

/**
 * Creating the city product set that a launch is blocked on.
 *
 * Without this the blocked state is a dead end: the app tells you a product set
 * is missing, and the only way forward is to leave, open Commerce Manager,
 * create it by hand, come back and type its ID. The app already knows the
 * catalogue and the exact filter, so it can just make it.
 *
 * The count is read back afterwards rather than assumed. A set that matches
 * eleven vehicles is a fact worth knowing before the campaign launches, not
 * after.
 */

interface Body {
  cityName?: string;
  /** Several cities, for a consolidated campaign's single product set. */
  cityNames?: string[];
  catalogueId?: string;
  /** When true, only report how many vehicles the filter would match. */
  checkOnly?: boolean;
}

export async function POST(req: Request) {
  const { error } = await requireEditor();
  if (error) return error;

  const body = (await req.json()) as Body;
  const cityList = (body.cityNames?.length ? body.cityNames : body.cityName ? [body.cityName] : [])
    .map((c) => c.trim())
    .filter(Boolean);
  if (cityList.length === 0) return NextResponse.json({ error: "At least one city is required." }, { status: 400 });
  const cityName = cityList.join(" + ");

  if (process.env.USE_MOCK_META !== "false" || !process.env.META_ACCESS_TOKEN?.trim()) {
    return NextResponse.json(
      {
        error:
          "Creating a product set needs live credentials. Until then, create it in Commerce Manager and record its ID here.",
        filterRule: multiCityFilterRule(cityList),
        catalogueId: body.catalogueId ?? DEFAULT_CATALOGUE_ID,
      },
      { status: 409 }
    );
  }

  const catalogueId = body.catalogueId ?? DEFAULT_CATALOGUE_ID;
  const filter = multiCityFilterRule(cityList);
  const name = cityList.length === 1 ? `${cityList[0]} Catalogue` : `${cityList.join(" + ")} Catalogue`;

  try {
    if (body.checkOnly) {
      // Ask the catalogue how many products match before creating anything.
      const probe = await graphGet<{ data: unknown[]; summary?: { total_count: number } }>(
        `${catalogueId}/products`,
        { filter, summary: "total_count", limit: "1" }
      );
      return NextResponse.json({
        checked: true,
        productCount: probe.summary?.total_count ?? 0,
        filterRule: filter,
      });
    }

    // Reuse before create. A duplicate set is not a harmless duplicate: two
    // sets on the same filter mean two things to keep in step, and an ad bound
    // to the wrong one is invisible until someone compares product counts.
    const existing = await findExistingCitySet(catalogueId, filter);
    if (existing) {
      return NextResponse.json({
        productSetId: existing.id,
        name: existing.name,
        productCount: existing.product_count ?? 0,
        filterRule: filter,
        catalogueId,
        reused: true,
        note: `${existing.name} already exists in this catalogue on the same filter, so it was reused rather than duplicated.`,
      });
    }

    // Count before creating. Meta refuses an empty set anyway ("We disallow the
    // creation of empty product sets"), but its wording sounds like a quota
    // rule rather than what it is: this catalogue holds no vehicles for this
    // city. Say that instead, because the fix is inventory, not permissions,
    // and an operator reading Meta's version goes looking in the wrong place.
    const probe = await graphGet<{ summary?: { total_count: number } }>(
      `${catalogueId}/products`,
      { filter, summary: "total_count", limit: "1" }
    );
    const available = probe.summary?.total_count ?? 0;
    if (available === 0) {
      return NextResponse.json(
        {
          error:
            `${cityName} ${cityList.length === 1 ? "has" : "have"} no vehicles in this catalogue, so there is nothing to put in a product set. ` +
            `The filter ${filter} matches 0 of the catalogue's products. This is an inventory gap, not a ` +
            `permissions problem — the feed has to carry ${cityName} before a campaign here can deliver.`,
          productCount: 0,
          emptyCity: true,
          filterRule: filter,
          catalogueId,
        },
        { status: 409 }
      );
    }

    const created = await graphPost<{ id: string }>(`${catalogueId}/product_sets`, { name, filter });

    // Read the real count back rather than trusting the request.
    const detail = await graphGet<{ id: string; name: string; product_count?: number }>(created.id, {
      fields: "id,name,product_count",
    });

    return NextResponse.json({
      productSetId: detail.id,
      name: detail.name ?? name,
      productCount: detail.product_count ?? 0,
      filterRule: filter,
      catalogueId,
    });
  } catch (err) {
    const permission = explainCatalogueRefusal(err, catalogueId);
    return NextResponse.json(
      {
        error: permission ?? (err instanceof Error ? err.message : String(err)),
        needsCatalogPermission: Boolean(permission),
        filterRule: filter,
        catalogueId,
      },
      { status: permission ? 403 : 502 }
    );
  }
}
