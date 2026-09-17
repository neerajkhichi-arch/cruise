// ---------------------------------------------------------------------------
// Catalogues and product sets — pulled from the live CarDekho business
// (business 10153160932409601) on 2026-09-01.
//
// The account's actual pattern: ONE pan-India vehicles catalogue, with one
// dynamic product set per city filtered on `city`. Mohali's product set was
// created on 2026-08-31 — the same day the Mohali campaign launched — which is
// what makes this a launch step rather than a setting.
//
// A catalogue ad cannot deliver without both a catalogue and a product set
// bound to the ad set, so the launch wizard treats a missing product set as a
// hard block rather than a warning.
// ---------------------------------------------------------------------------

export interface RealProductSet {
  productSetId: string;
  catalogueId: string;
  name: string;
  productCount: number;
  /** Meta filter rule JSON. For this account, always a city equality match. */
  filterRule: string;
  /** City the filter resolves to, or null for an unfiltered set. */
  cityKey: string | null;
  createdAt: string;
}

export interface RealCatalogue {
  catalogueId: string;
  name: string;
  vertical: "vehicles" | "commerce";
  /** True for the catalogue the live campaigns actually run against. */
  inUse: boolean;
  /** Product sets with items Meta has blocked from ads. */
  blockedProductSets: { productSetId: string; blockedItems: number }[];
  note?: string;
}

export const REAL_CATALOGUES: RealCatalogue[] = [
  {
    catalogueId: "798263859980981",
    name: "Catalog_Vehicles-Pan-India-20-July",
    vertical: "vehicles",
    inUse: true,
    blockedProductSets: [],
    note: "The live catalogue. City product sets are dynamic, filtered on `city`.",
  },
  { catalogueId: "1608155503355566", name: "UCR-Classifieds-2024", vertical: "vehicles", inUse: false, blockedProductSets: [] },
  { catalogueId: "881943402359537", name: "ZWPH_Car_Inventory", vertical: "vehicles", inUse: false, blockedProductSets: [] },
  { catalogueId: "503220460164685", name: "Catalog_Vehicles_Oto", vertical: "vehicles", inUse: false, blockedProductSets: [] },
  { catalogueId: "1776501322651111", name: "Used Car Vehicle (for Live)", vertical: "vehicles", inUse: false, blockedProductSets: [] },
  {
    catalogueId: "1938048646458310",
    name: "Used_Car_Test (For Testing Purpose)",
    vertical: "vehicles",
    inUse: false,
    blockedProductSets: [],
    note: "Test catalogue. Never select this for a live launch.",
  },
  {
    catalogueId: "2350020195493488",
    name: "Catalog_Products-Nashik",
    vertical: "commerce",
    inUse: false,
    blockedProductSets: [{ productSetId: "901762809565875", blockedItems: 4 }],
    note: "Superseded by the pan-India vehicles catalogue. Has blocked items.",
  },
  { catalogueId: "1990153301577840", name: "Catalog_Products-Ahemdabad", vertical: "commerce", inUse: false, blockedProductSets: [] },
  {
    catalogueId: "1607203650535357",
    name: "Catalog_Products-CHD",
    vertical: "commerce",
    inUse: false,
    blockedProductSets: [{ productSetId: "962699676140559", blockedItems: 1 }],
    note: "Duplicate name with catalogue 1266397498384174. Has blocked items.",
  },
  {
    catalogueId: "1266397498384174",
    name: "Catalog_Products-CHD",
    vertical: "commerce",
    inUse: false,
    blockedProductSets: [],
    note: "Duplicate name with catalogue 1607203650535357.",
  },
  { catalogueId: "812748218543177", name: "Ahemdabad-Usedcars", vertical: "commerce", inUse: false, blockedProductSets: [] },
  { catalogueId: "1915660745750745", name: "Catalogue_Products", vertical: "commerce", inUse: false, blockedProductSets: [] },
];

/**
 * Re-read from the live catalogue on 2026-09-07. Two things worth stating:
 *
 *   1. The five city sets sum to 3,608 — exactly the "All Vehicles" count. The
 *      catalogue therefore holds Ahmedabad, Nashik, Chandigarh, Mohali and
 *      Gurgaon and nothing else. A product set for Jaipur, Lucknow, Delhi,
 *      Noida or Pune would be created successfully and match zero vehicles,
 *      which is why a zero-count set is a launch BLOCK rather than a warning.
 *   2. `productCount` is a dated snapshot and drifts as inventory turns over.
 *      Anything that matters reads the count back from the API; these numbers
 *      exist for the no-token preview.
 */
export const REAL_PRODUCT_SETS: RealProductSet[] = [
  {
    productSetId: "920169403676035",
    catalogueId: "798263859980981",
    name: "Ahmedabad Catalog",
    productCount: 1321,
    filterRule: '{"city":{"eq":"ahmedabad"}}',
    cityKey: "ahmedabad",
    createdAt: "2026-07-20",
  },
  {
    productSetId: "1030712096095233",
    catalogueId: "798263859980981",
    name: "Nashik Catalogue",
    productCount: 1146,
    filterRule: '{"city":{"eq":"nashik"}}',
    cityKey: "nashik",
    createdAt: "2026-07-20",
  },
  {
    productSetId: "3941535179486261",
    catalogueId: "798263859980981",
    name: "Chandigarh Catalogue",
    productCount: 482,
    filterRule: '{"city":{"eq":"chandigarh"}}',
    cityKey: "chandigarh",
    createdAt: "2026-07-20",
  },
  {
    productSetId: "1467107688579032",
    catalogueId: "798263859980981",
    name: "Mohali catalog",
    productCount: 446,
    filterRule: '{"city":{"eq":"mohali"}}',
    cityKey: "mohali",
    createdAt: "2026-08-31",
  },
  {
    // Created by hand in Commerce Manager on 2026-09-04, after this app's
    // "create it in the catalogue" button was refused for want of
    // catalog_management. Same filter shape as every other city.
    productSetId: "1050933764411522",
    catalogueId: "798263859980981",
    name: "Gurgaon Catalogue",
    productCount: 213,
    filterRule: '{"city":{"eq":"gurgaon"}}',
    cityKey: "gurgaon",
    createdAt: "2026-09-04",
  },
  {
    productSetId: "1548657626908860",
    catalogueId: "798263859980981",
    name: "All Vehicles",
    productCount: 3608,
    filterRule: "",
    cityKey: null,
    createdAt: "2026-07-20",
  },
];

/** The catalogue a new city should launch against, unless told otherwise. */
export const DEFAULT_CATALOGUE_ID = "798263859980981";

/** The filter rule a new city's product set needs. */
export function cityFilterRule(cityName: string): string {
  return JSON.stringify({ city: { eq: cityName.trim().toLowerCase() } });
}

/**
 * A product set spanning several cities, for a consolidated campaign.
 *
 * `is_any` rather than a set per city, because one ad can only draw from one
 * product set. The consequence is worth stating plainly where it is created: a
 * buyer in any of these cities can be shown a car in any of the others, since
 * Meta picks from the whole set by predicted performance and has no idea the
 * stock is location-bound. For used cars that is a real cost, and it is the
 * price of putting several cities in one ad set.
 */
export function multiCityFilterRule(cityNames: string[]): string {
  const cities = [...new Set(cityNames.map((c) => c.trim().toLowerCase()).filter(Boolean))].sort();
  if (cities.length === 1) return cityFilterRule(cities[0]);
  return JSON.stringify({ city: { is_any: cities } });
}
