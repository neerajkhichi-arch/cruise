// ---------------------------------------------------------------------------
// City → state lookup for India.
//
// Used so replicating a campaign only asks for the city and fills the state in.
// This is geography, not account data — it does not come from the ad account
// and is not derived from anything measured. A city that is not listed here
// falls back to a manual state entry rather than a guess.
// ---------------------------------------------------------------------------

export interface IndiaCity {
  name: string;
  state: string;
  /** Rough tier, used only as a default label on a newly created city row. */
  tier: "Tier 1" | "Tier 2" | "Tier 3";
}

export const INDIA_CITIES: IndiaCity[] = [
  // --- cities the account already runs ---
  { name: "Ahmedabad", state: "Gujarat", tier: "Tier 1" },
  { name: "Nashik", state: "Maharashtra", tier: "Tier 2" },
  { name: "Chandigarh", state: "Chandigarh", tier: "Tier 2" },
  { name: "Mohali", state: "Punjab", tier: "Tier 2" },
  { name: "Delhi NCR", state: "Delhi", tier: "Tier 1" },

  // --- Tier 1 ---
  { name: "Mumbai", state: "Maharashtra", tier: "Tier 1" },
  { name: "Delhi", state: "Delhi", tier: "Tier 1" },
  { name: "Bengaluru", state: "Karnataka", tier: "Tier 1" },
  { name: "Hyderabad", state: "Telangana", tier: "Tier 1" },
  { name: "Chennai", state: "Tamil Nadu", tier: "Tier 1" },
  { name: "Kolkata", state: "West Bengal", tier: "Tier 1" },
  { name: "Pune", state: "Maharashtra", tier: "Tier 1" },

  // --- Tier 2 ---
  { name: "Jaipur", state: "Rajasthan", tier: "Tier 2" },
  { name: "Lucknow", state: "Uttar Pradesh", tier: "Tier 2" },
  { name: "Kanpur", state: "Uttar Pradesh", tier: "Tier 2" },
  { name: "Nagpur", state: "Maharashtra", tier: "Tier 2" },
  { name: "Indore", state: "Madhya Pradesh", tier: "Tier 2" },
  { name: "Bhopal", state: "Madhya Pradesh", tier: "Tier 2" },
  { name: "Surat", state: "Gujarat", tier: "Tier 2" },
  { name: "Vadodara", state: "Gujarat", tier: "Tier 2" },
  { name: "Rajkot", state: "Gujarat", tier: "Tier 2" },
  { name: "Ludhiana", state: "Punjab", tier: "Tier 2" },
  { name: "Amritsar", state: "Punjab", tier: "Tier 2" },
  { name: "Jalandhar", state: "Punjab", tier: "Tier 2" },
  { name: "Patna", state: "Bihar", tier: "Tier 2" },
  { name: "Bhubaneswar", state: "Odisha", tier: "Tier 2" },
  { name: "Coimbatore", state: "Tamil Nadu", tier: "Tier 2" },
  { name: "Madurai", state: "Tamil Nadu", tier: "Tier 2" },
  { name: "Kochi", state: "Kerala", tier: "Tier 2" },
  { name: "Thiruvananthapuram", state: "Kerala", tier: "Tier 2" },
  { name: "Visakhapatnam", state: "Andhra Pradesh", tier: "Tier 2" },
  { name: "Vijayawada", state: "Andhra Pradesh", tier: "Tier 2" },
  { name: "Guwahati", state: "Assam", tier: "Tier 2" },
  { name: "Dehradun", state: "Uttarakhand", tier: "Tier 2" },
  { name: "Raipur", state: "Chhattisgarh", tier: "Tier 2" },
  { name: "Ranchi", state: "Jharkhand", tier: "Tier 2" },
  { name: "Agra", state: "Uttar Pradesh", tier: "Tier 2" },
  { name: "Varanasi", state: "Uttar Pradesh", tier: "Tier 2" },
  { name: "Meerut", state: "Uttar Pradesh", tier: "Tier 2" },
  { name: "Ghaziabad", state: "Uttar Pradesh", tier: "Tier 2" },
  { name: "Noida", state: "Uttar Pradesh", tier: "Tier 2" },
  { name: "Gurgaon", state: "Haryana", tier: "Tier 2" },
  { name: "Faridabad", state: "Haryana", tier: "Tier 2" },
  { name: "Aurangabad", state: "Maharashtra", tier: "Tier 2" },
  { name: "Thane", state: "Maharashtra", tier: "Tier 2" },
  { name: "Mysuru", state: "Karnataka", tier: "Tier 2" },
  { name: "Mangaluru", state: "Karnataka", tier: "Tier 2" },
  { name: "Hubballi", state: "Karnataka", tier: "Tier 2" },
  { name: "Jodhpur", state: "Rajasthan", tier: "Tier 2" },
  { name: "Udaipur", state: "Rajasthan", tier: "Tier 2" },
  { name: "Kota", state: "Rajasthan", tier: "Tier 2" },
  { name: "Siliguri", state: "West Bengal", tier: "Tier 3" },
  { name: "Jamshedpur", state: "Jharkhand", tier: "Tier 3" },
  { name: "Panaji", state: "Goa", tier: "Tier 3" },
  { name: "Shimla", state: "Himachal Pradesh", tier: "Tier 3" },
  { name: "Jammu", state: "Jammu and Kashmir", tier: "Tier 3" },
  { name: "Puducherry", state: "Puducherry", tier: "Tier 3" },
];

/**
 * Renamed and colloquial city names.
 *
 * This exists because of a real, expensive near-miss. Meta's geo tree lists
 * Haryana's city under its official name GURUGRAM. It also contains a small
 * village in Maharashtra genuinely called GURGAON. So searching Meta for
 * "Gurgaon" returns exactly one exact match — the Maharashtra village — and
 * code that trusts a single exact match targets the wrong state with complete
 * confidence. That is precisely what happened: an ad set built for CarDekho's
 * Gurgaon dealers was pointed at "India: Gurgaon Maharashtra".
 *
 * Every entry here is a name change or a common alternate spelling, so a search
 * for either name finds the same place. Each key and value is a name people
 * actually type or that Meta actually stores.
 */
export const CITY_ALIASES: Record<string, string[]> = {
  gurgaon: ["Gurugram"],
  gurugram: ["Gurgaon"],
  bangalore: ["Bengaluru"],
  bengaluru: ["Bangalore"],
  bombay: ["Mumbai"],
  mumbai: ["Bombay"],
  calcutta: ["Kolkata"],
  kolkata: ["Calcutta"],
  madras: ["Chennai"],
  chennai: ["Madras"],
  mysore: ["Mysuru"],
  mysuru: ["Mysore"],
  mangalore: ["Mangaluru"],
  mangaluru: ["Mangalore"],
  hubli: ["Hubballi"],
  hubballi: ["Hubli"],
  trivandrum: ["Thiruvananthapuram"],
  thiruvananthapuram: ["Trivandrum"],
  baroda: ["Vadodara"],
  vadodara: ["Baroda"],
  cochin: ["Kochi"],
  kochi: ["Cochin"],
  poona: ["Pune"],
  pune: ["Poona"],
  pondicherry: ["Puducherry"],
  puducherry: ["Pondicherry"],
  panjim: ["Panaji"],
  panaji: ["Panjim"],
  allahabad: ["Prayagraj"],
  prayagraj: ["Allahabad"],
  aurangabad: ["Chhatrapati Sambhajinagar"],
  gauhati: ["Guwahati"],
  guwahati: ["Gauhati"],
  // Meta stores the twin city hyphenated. Searching it as two words returned
  // nothing at all, which read on screen as "Meta has no Indian city matching
  // Pimpri Chinchwad" — a city of two million.
  "pimpri chinchwad": ["Pimpri-Chinchwad", "Pimpri Chinchwad"],
  "pimpri-chinchwad": ["Pimpri Chinchwad"],
  "navi mumbai": ["Navi Mumbai", "New Bombay"],
  secunderabad: ["Hyderabad"],
};

/**
 * States under every name they get typed under.
 *
 * This exists because a bulk upload was refused with "Dehradun should be in
 * Uttaranchal, but Meta's matches are in Uttarakhand". Both names are the same
 * state — Uttaranchal was renamed Uttarakhand in 2007 — and the sheet simply
 * carried the older one. Comparing the two strings literally turned a naming
 * difference into a refusal. The check was right; the comparison was too
 * literal.
 */
const STATE_ALIASES: Record<string, string> = {
  uttaranchal: "uttarakhand",
  orissa: "odisha",
  pondicherry: "puducherry",
  "nct of delhi": "delhi",
  "national capital territory of delhi": "delhi",
  "new delhi": "delhi",
  "delhi ncr": "delhi",
  tamilnadu: "tamil nadu",
  chattisgarh: "chhattisgarh",
  "jammu & kashmir": "jammu and kashmir",
  "j&k": "jammu and kashmir",
  bengal: "west bengal",
  "andaman & nicobar islands": "andaman and nicobar islands",
  "dadra & nagar haveli": "dadra and nagar haveli and daman and diu",
  "daman & diu": "dadra and nagar haveli and daman and diu",
};

const normState = (s: string) => s.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");

/** Whether two state names mean the same state, allowing for renames. */
export function sameState(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const canon = (s: string) => {
    const n = normState(s);
    return STATE_ALIASES[n] ?? n;
  };
  return canon(a) === canon(b);
}

const BY_KEY = new Map(INDIA_CITIES.map((c) => [c.name.trim().toLowerCase(), c]));

/** Resolve a typed city name to its state, following aliases. Null when unknown. */
export function lookupCity(name: string): IndiaCity | null {
  const key = name.trim().toLowerCase();
  const direct = BY_KEY.get(key);
  if (direct) return direct;
  for (const alias of CITY_ALIASES[key] ?? []) {
    const hit = BY_KEY.get(alias.trim().toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/**
 * Every name worth searching Meta for when looking for this city — the name as
 * typed, plus any official rename. Searching only what the operator typed is
 * how "Gurgaon" failed to find Gurugram.
 */
export function citySearchNames(name: string): string[] {
  const typed = name.trim();
  const out = [typed, ...(CITY_ALIASES[typed.toLowerCase()] ?? [])];

  // Punctuation variants, because Meta stores some names hyphenated and people
  // type them spaced (and the reverse). Cheap, and it removes a whole class of
  // "no match" that is really a typography difference.
  for (const n of [...out]) {
    if (n.includes("-")) out.push(n.replace(/-/g, " "));
    if (/\s/.test(n)) out.push(n.replace(/\s+/g, "-"));
  }

  return [...new Map(out.map((n) => [n.toLowerCase(), n])).values()];
}

/** Type-ahead suggestions, excluding cities already in the platform. */
export function suggestCities(query: string, exclude: string[] = [], limit = 8): IndiaCity[] {
  const q = query.trim().toLowerCase();
  const taken = new Set(exclude.map((e) => e.trim().toLowerCase()));
  if (!q) return [];
  return INDIA_CITIES.filter(
    (c) => c.name.toLowerCase().includes(q) && !taken.has(c.name.toLowerCase())
  ).slice(0, limit);
}
