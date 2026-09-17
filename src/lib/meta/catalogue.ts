/**
 * The vehicles Meta can actually serve.
 *
 * The Inventory screen used to render 4,706 generated rows with picsum.photos
 * placeholder images — invented makes, invented prices, invented dealers, an
 * invented "health score". It looked like inventory and was worth nothing.
 *
 * This reads the catalogue instead, which is the only inventory that matters
 * for advertising: a car CarDekho holds but has not fed to Meta cannot appear
 * in an ad, however real it is. A city with no products here is a launch
 * blocker, and that is the fact the screen should be making obvious.
 *
 * City comes from the product SET, not from the item. Each city set is a
 * dynamic rule on `city`, so membership of the set is the city — no parsing of
 * names or URLs, which is the same discipline applied everywhere else here.
 *
 * ---------------------------------------------------------------------------
 * A catalogue's VERTICAL decides its edge, and getting that wrong blanks the
 * page.
 *
 * The first version of this file read `{set_id}/products` for everything, which
 * Meta rejected with:
 *
 *   Endpoint not supported for this vertical: Data available only for
 *   catalogues of type "commerce" (code 3/1798083)
 *
 * Catalog_Vehicles-Pan-India-20-July is `vertical: "vehicles"`, so its items
 * live on `/vehicles` and are Vehicle nodes, not Product nodes: `vehicle_id`
 * not `retailer_id`, `title` not `name`, `images[]` not `image_url`. The edge
 * and the field list are therefore chosen from the vertical, read from the
 * catalogue itself rather than assumed.
 *
 * The upside is that year, mileage, colour, make and model are real fields on a
 * Vehicle. The old code scraped them out of the description with regexes
 * because on a Product node there was nowhere else to get them. Those regexes
 * survive only as a fallback for a feed that leaves the real fields empty.
 */

import { GraphError, graphGet } from "./graph";
import { TTL, cached } from "./cache";
import { DEFAULT_CATALOGUE_ID } from "../../../scripts/real-catalogue-data";

export interface CatalogueVehicle {
  productId: string;
  retailerId: string;
  name: string;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string;
  visibility: string | null;
  cityName: string;
  year: number | null;
  kmDriven: number | null;
  colour: string | null;
  /** Vehicle verticals only; null on a commerce catalogue. */
  make: string | null;
  model: string | null;
  transmission: string | null;
}

export interface CatalogueCity {
  cityName: string;
  productSetId: string;
  productCount: number;
}

export interface CatalogueResult {
  catalogueId: string;
  catalogueName: string;
  /** "vehicles", "commerce", … — shown on the page so the shape is never a guess. */
  vertical: string;
  cities: CatalogueCity[];
  vehicles: CatalogueVehicle[];
  totalProducts: number;
  /** True when more exist than were fetched — the screen must not imply a total. */
  truncated: boolean;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Vertical → edge and fields
// ---------------------------------------------------------------------------

/**
 * Meta names the items edge after the vertical. `/products` is the commerce
 * one, and is what every code sample on the internet shows, which is exactly
 * why it is easy to write by mistake against a vehicles catalogue.
 */
const VERTICAL_EDGE: Record<string, string> = {
  commerce: "products",
  offline_commerce: "products",
  vehicles: "vehicles",
  vehicle_offers: "vehicle_offers",
  hotels: "hotels",
  flights: "flights",
  destinations: "destinations",
  home_listings: "home_listings",
};

/**
 * Rich field list first, bare list as a fallback.
 *
 * Meta rejects an entire request for one unrecognised field, so a field this
 * account's feed does not populate would blank the page exactly the way the
 * wrong edge just did. The fallback means the worst case is fewer columns, not
 * an empty screen.
 */
const FIELDS: Record<string, { rich: string; minimal: string }> = {
  products: {
    rich: "product_id,retailer_id,name,description,url,price,image_url,visibility",
    minimal: "product_id,retailer_id,name,url,price,image_url",
  },
  vehicles: {
    rich:
      "id,vehicle_id,title,description,url,images,make,model,year,mileage," +
      "exterior_color,price,currency,availability,state_of_vehicle,transmission,visibility",
    minimal: "id,vehicle_id,title,url,price,images",
  },
};

function fieldsFor(edge: string) {
  return FIELDS[edge] ?? FIELDS.products;
}

/** A rejection about the field list, as opposed to a rate limit or a permission. */
function isFieldError(err: unknown): boolean {
  if (!(err instanceof GraphError)) return false;
  return /nonexist|unknown field|does not exist|Invalid parameter|unsupported get request/i.test(err.message);
}

// ---------------------------------------------------------------------------
// Reading items
// ---------------------------------------------------------------------------

interface RawItem {
  // Product node
  product_id?: string;
  retailer_id?: string;
  name?: string;
  image_url?: string;
  // Vehicle node
  id?: string;
  vehicle_id?: string;
  title?: string;
  images?: ({ url?: string } | string)[];
  make?: string;
  model?: string;
  year?: number | string;
  mileage?: { value?: number | string; unit?: string } | number | string;
  exterior_color?: string;
  currency?: string;
  transmission?: string;
  state_of_vehicle?: string;
  // Either
  description?: string;
  url?: string;
  visibility?: string;
  availability?: string;
  price?: { amount?: string; currency?: string } | string | number;
}

/**
 * "2014 Maruti Wagon R VXI, 24000 km driven, Silver color"
 *
 * On a Product node the feed puts year, mileage and colour in prose and nowhere
 * else. On a Vehicle node they are real fields, so this now only fills gaps.
 * Narrow patterns, null on failure — a wrong year on a car listing is worse
 * than a blank one.
 */
function parseDescription(d: string | null): { year: number | null; kmDriven: number | null; colour: string | null } {
  if (!d) return { year: null, kmDriven: null, colour: null };
  const year = d.match(/\b(19|20)\d{2}\b/)?.[0];
  const km = d.match(/([\d,]+)\s*km\s*driven/i)?.[1];
  const colour = d.match(/,\s*([A-Za-z ]+?)\s*colou?r/i)?.[1];
  const y = year ? Number(year) : null;
  return {
    year: y && y >= 1980 && y <= new Date().getFullYear() + 1 ? y : null,
    kmDriven: km ? Number(km.replace(/,/g, "")) : null,
    colour: colour?.trim() || null,
  };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function readPrice(p: RawItem["price"], currency?: string): { price: number | null; currency: string } {
  if (p === null || p === undefined) return { price: null, currency: currency ?? "INR" };
  if (typeof p === "object") {
    return { price: num(p.amount), currency: p.currency ?? currency ?? "INR" };
  }
  // Vehicles return a string, sometimes formatted ("₹21,25,000.00"), with the
  // currency in its own field.
  return { price: num(p), currency: currency ?? "INR" };
}

function readImage(item: RawItem): string | null {
  if (item.image_url) return item.image_url;
  const first = item.images?.[0];
  if (!first) return null;
  return typeof first === "string" ? first : (first.url ?? null);
}

function readMileage(m: RawItem["mileage"]): number | null {
  if (m === null || m === undefined) return null;
  if (typeof m === "object") return num(m.value);
  return num(m);
}

function normalise(item: RawItem, cityName: string): CatalogueVehicle {
  const description = item.description ?? null;
  const fallback = parseDescription(description);
  const { price, currency } = readPrice(item.price, item.currency);

  // A Vehicle has no `name`; build one from make/model when `title` is absent
  // rather than printing "(untitled)" over a real car.
  const name =
    item.name ??
    item.title ??
    [item.year, item.make, item.model].filter(Boolean).join(" ").trim() ??
    "";

  return {
    productId: item.product_id ?? item.id ?? item.vehicle_id ?? "",
    retailerId: item.retailer_id ?? item.vehicle_id ?? "",
    name: name || "(untitled)",
    description,
    url: item.url ?? null,
    imageUrl: readImage(item),
    price,
    currency,
    visibility: item.visibility ?? item.availability ?? item.state_of_vehicle ?? null,
    cityName,
    year: num(item.year) ?? fallback.year,
    kmDriven: readMileage(item.mileage) ?? fallback.kmDriven,
    colour: item.exterior_color ?? fallback.colour,
    make: item.make ?? null,
    model: item.model ?? null,
    transmission: item.transmission ?? null,
  };
}

/** One page of a set's items, capped — this is a browse, not an export. */
async function itemsInSet(
  setId: string,
  cityName: string,
  limit: number,
  edge: string,
  onNote: (note: string) => void
): Promise<CatalogueVehicle[]> {
  const { rich, minimal } = fieldsFor(edge);
  let fields = rich;
  const out: CatalogueVehicle[] = [];
  let after: string | undefined;

  while (out.length < limit) {
    let page: { data: RawItem[]; paging?: { cursors?: { after?: string }; next?: string } };
    try {
      page = await graphGet(`${setId}/${edge}`, {
        fields,
        limit: String(Math.min(100, limit - out.length)),
        ...(after ? { after } : {}),
      });
    } catch (err) {
      // One unrecognised field should cost columns, not the whole screen.
      if (fields === rich && isFieldError(err)) {
        onNote(
          `Meta rejected some catalogue fields, so these vehicles are shown with the basics only. (${(err as GraphError).message})`
        );
        fields = minimal;
        continue;
      }
      throw err;
    }

    for (const item of page.data ?? []) out.push(normalise(item, cityName));

    after = page.paging?.next ? page.paging?.cursors?.after : undefined;
    if (!after) break;
  }
  return out;
}

// ---------------------------------------------------------------------------

/**
 * @param perCity how many vehicles to fetch per city. Deliberately capped:
 * 4,000 items is many pages, and this account is rate-limited per ACCOUNT,
 * so an uncapped browse would block publishing as well as itself.
 */
/**
 * Just the per-city vehicle counts — one Graph call, no product pages.
 *
 * The Dashboard and Cities screens want a number per city, nothing more. They
 * were calling getCatalogueInventory(), which also fetches up to sixty vehicles
 * for every city — roughly eight extra calls per page load, on an account Meta
 * rate-limits as a whole. That is what put "too many API calls" on the
 * Campaigns screen, and a rate limit also blocks publishing, so a reporting
 * page can stop a launch.
 *
 * `product_count` comes back on the product_sets listing itself, so the counts
 * cost exactly one call.
 */
export async function getCatalogueCityCounts(
  catalogueId = DEFAULT_CATALOGUE_ID
): Promise<CatalogueCity[]> {
  const sets = await cached(`catalogue-sets:${catalogueId}`, TTL.catalogue, () =>
    graphGet<{ data: { id: string; name: string; product_count?: number; filter?: string }[] }>(
      `${catalogueId}/product_sets`,
      { fields: "id,name,product_count,filter", limit: "100" }
    )
  );

  return (sets.data ?? [])
    .map((s) => {
      let city: string | null = null;
      try {
        city = (JSON.parse(s.filter || "{}") as { city?: { eq?: string } }).city?.eq ?? null;
      } catch {
        city = null;
      }
      return city
        ? {
            cityName: city.replace(/\b\w/g, (c) => c.toUpperCase()),
            productSetId: s.id,
            productCount: s.product_count ?? 0,
          }
        : null;
    })
    .filter((c): c is CatalogueCity => c !== null)
    .sort((a, b) => b.productCount - a.productCount);
}

export async function getCatalogueInventory(
  catalogueId = DEFAULT_CATALOGUE_ID,
  perCity = 60
): Promise<CatalogueResult> {
  const notes: string[] = [];
  const note = (n: string) => {
    if (!notes.includes(n)) notes.push(n);
  };

  const meta = await cached(`catalogue:${catalogueId}`, TTL.catalogue, () =>
    graphGet<{ id: string; name: string; product_count?: number; vertical?: string }>(catalogueId, {
      fields: "id,name,product_count,vertical",
    })
  );

  const vertical = meta.vertical ?? "commerce";
  const edge = VERTICAL_EDGE[vertical];
  if (!edge) {
    return {
      catalogueId,
      catalogueName: meta.name,
      vertical,
      cities: [],
      vehicles: [],
      totalProducts: meta.product_count ?? 0,
      truncated: false,
      notes: [
        `This catalogue's vertical is "${vertical}", which this app does not know how to read yet. ` +
          `Meta serves each vertical on its own edge, and guessing the wrong one returns nothing rather than failing loudly.`,
      ],
    };
  }

  const sets = await cached(`catalogue-sets:${catalogueId}`, TTL.catalogue, () =>
    graphGet<{ data: { id: string; name: string; product_count?: number; filter?: string }[] }>(
      `${catalogueId}/product_sets`,
      { fields: "id,name,product_count,filter", limit: "100" }
    )
  );

  // City sets only. "All Vehicles" has no filter and would duplicate every car
  // under a meaningless heading; a set that filters on something else (a trim
  // level, a custom label) is a real set but not a city.
  const all = (sets.data ?? []).map((s) => {
    let city: string | null = null;
    try {
      city = (JSON.parse(s.filter || "{}") as { city?: { eq?: string } }).city?.eq ?? null;
    } catch {
      city = null;
    }
    return { id: s.id, name: s.name, city, count: s.product_count ?? 0 };
  });

  const citySets = all.filter((s) => s.city !== null).sort((a, b) => b.count - a.count);
  const otherSets = all.filter((s) => s.city === null && s.name !== "All Vehicles");

  if (citySets.length === 0) {
    note("No city product sets in this catalogue, so there is nothing to group vehicles by.");
  }
  if (otherSets.length > 0) {
    // Answers "why isn't <set> here" with something other than silence.
    note(
      `Not shown: ${otherSets.map((s) => s.name).join(", ")} — ${otherSets.length === 1 ? "this set is" : "these sets are"} not filtered by city, so ${otherSets.length === 1 ? "it has" : "they have"} no city to group under.`
    );
  }

  const title = (c: string) => c.replace(/\b\w/g, (ch) => ch.toUpperCase());

  const perSet = await Promise.all(
    citySets.map((s) =>
      cached(`catalogue-items:${edge}:${s.id}:${perCity}`, TTL.catalogue, () =>
        // Title-case the city, since the filter value is lowercase.
        itemsInSet(s.id, title(s.city!), perCity, edge, note)
      )
    )
  );

  const vehicles = perSet.flat();
  const cities: CatalogueCity[] = citySets.map((s) => ({
    cityName: title(s.city!),
    productSetId: s.id,
    productCount: s.count,
  }));

  const totalInCitySets = cities.reduce((sum, c) => sum + c.productCount, 0);
  const truncated = vehicles.length < totalInCitySets;
  if (truncated) {
    note(
      `Showing ${vehicles.length.toLocaleString("en-IN")} of ${totalInCitySets.toLocaleString("en-IN")} vehicles — ${perCity} per city, to keep this inside Meta's rate limit.`
    );
  }

  const noImage = vehicles.filter((v) => !v.imageUrl).length;
  if (noImage > 0) {
    note(
      `${noImage} of the vehicles shown have no image in the catalogue. A catalogue ad with no image cannot render, so these are worth fixing in the feed.`
    );
  }

  return {
    catalogueId,
    catalogueName: meta.name,
    vertical,
    cities,
    vehicles,
    totalProducts: meta.product_count ?? totalInCitySets,
    truncated,
    notes,
  };
}
