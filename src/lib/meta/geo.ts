/**
 * Resolving a city name to Meta's numeric geo key.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO PREVENT
 *
 * Replicating into Gurgaon produced an ad set targeting "India: Gurgaon
 * Maharashtra" — a village roughly 1,300 km from CarDekho's Gurgaon dealers.
 * Nothing errored. Meta accepted it, Ads Manager displayed it, and the only
 * outward sign was an audience-size warning that reads like ordinary advice.
 *
 * The cause was not Meta. Haryana's city is listed by Meta under its official
 * name GURUGRAM, and Maharashtra really does have a village called GURGAON. So
 * searching for "Gurgaon" returned exactly one exact-name match, and both the
 * publish and replicate paths contained the same line:
 *
 *     if (exact.length === 1) geoKey = exact[0].key;
 *
 * One match was treated as certainty. But `india-cities.ts` already knew
 * Gurgaon is in Haryana — the code simply never compared. The state was
 * consulted only to break ties between two matches, which is exactly backwards:
 * a single match in the wrong state is more dangerous than two matches, because
 * two matches stop and ask.
 *
 * So the rule here is:
 *
 *   A MATCH IN THE WRONG STATE IS A REFUSAL, NOT A RESULT — however few other
 *   matches there are.
 *
 * And both callers use this one function. Publish and replicate had separate,
 * subtly different copies of the resolution logic; fixing one would have left
 * the other wrong.
 * ---------------------------------------------------------------------------
 */

import { searchCity, searchPlaceOfAnyType, type GeoCity } from "./graph";
import { citySearchNames, lookupCity, sameState } from "../../../scripts/india-cities";
import { KNOWN_GEO_KEYS } from "../../../scripts/verified-account-facts";

export type GeoResolution =
  | {
      ok: true;
      key: string;
      /** Meta's own name for the place, which may differ from what was typed. */
      name: string;
      region: string;
      /** Worth showing the operator — e.g. that Gurgaon resolved via Gurugram. */
      note: string | null;
    }
  | {
      ok: false;
      reason: string;
      candidates: GeoCity[];
    };

const norm = (s: string) => s.trim().toLowerCase();

export async function resolveCityGeo(
  cityName: string,
  /** The state we believe this city is in. Omit only when genuinely unknown. */
  expectedState?: string | null
): Promise<GeoResolution> {
  // A key verified by hand against the live account beats any search.
  const known = KNOWN_GEO_KEYS[norm(cityName)];
  if (known) {
    return { ok: true, key: known, name: cityName, region: expectedState ?? "", note: null };
  }

  const state = expectedState?.trim() || lookupCity(cityName)?.state || null;
  const names = citySearchNames(cityName);

  // Search the typed name AND any official rename, then merge on Meta's key so
  // a city found under both names is one candidate, not two.
  const found = await Promise.all(names.map((n) => searchCity(n)));
  const byKey = new Map<string, GeoCity>();
  for (const list of found) for (const c of list) byKey.set(c.key, c);
  const candidates = [...byKey.values()];

  if (candidates.length === 0) {
    // Before reporting a place as unknown, ask what Meta DOES have under that
    // name. "No Indian city matching Pimpri Chinchwad" was technically true and
    // practically useless: the place exists, Meta files it differently, and the
    // operator was left with nothing to act on.
    let alsoKnownAs = "";
    try {
      const others = await searchPlaceOfAnyType(cityName);
      const inState = state ? others.filter((o) => sameState(o.region, state)) : others;
      const shortlist = (inState.length > 0 ? inState : others).slice(0, 3);
      if (shortlist.length > 0) {
        alsoKnownAs =
          ` Meta does list ${shortlist
            .map((o) => `"${o.name}" (${o.type}${o.region ? `, ${o.region}` : ""})`)
            .join(", ")} — those are not cities in Meta's targeting, so they cannot be used here. ` +
          `Target the parent city instead, or pick the place explicitly from Publish to Meta.`;
      }
    } catch {
      // The explanation is a courtesy; failing to fetch it must not change the
      // outcome, which is a refusal either way.
    }

    return {
      ok: false,
      reason:
        `Meta has no Indian city matching "${cityName}"${
          names.length > 1 ? ` (searched ${names.join(", ")})` : ""
        }.` + alsoKnownAs,
      candidates: [],
    };
  }

  // Exact name match against any of the names we searched — so Gurugram counts
  // as an exact match for Gurgaon.
  const wanted = new Set(names.map(norm));
  const exact = candidates.filter((c) => wanted.has(norm(c.name)));
  const pool = exact.length > 0 ? exact : candidates;

  if (state) {
    // sameState, not string equality: a sheet saying "Uttaranchal" and Meta
    // saying "Uttarakhand" are the same state, and refusing over the rename
    // would be the check misfiring rather than working.
    const inState = pool.filter((c) => sameState(c.region, state));

    if (inState.length === 1) {
      const hit = inState[0];
      const renamed = norm(hit.name) !== norm(cityName);
      return {
        ok: true,
        key: hit.key,
        name: hit.name,
        region: hit.region,
        note: renamed
          ? `Meta lists ${cityName} as "${hit.name}" (${hit.region}), which is the same place under its official name.`
          : null,
      };
    }

    if (inState.length > 1) {
      return {
        ok: false,
        reason: `Meta has ${inState.length} places called "${cityName}" in ${state}. Pick one rather than letting this guess.`,
        candidates: inState,
      };
    }

    // THE IMPORTANT BRANCH. Matches exist, but none is in the state we expect.
    // The old code accepted this silently whenever there was only one.
    return {
      ok: false,
      reason:
        `${cityName} should be in ${state}, but Meta's ${pool.length === 1 ? "only match" : `${pool.length} matches`} ` +
        `for that name ${pool.length === 1 ? "is" : "are"} in ${[...new Set(pool.map((c) => c.region))].join(", ")}. ` +
        `Targeting it would put the campaign in the wrong state, so this is refused rather than guessed. ` +
        `If the place you want really is ${pool[0].region}, publish it from Publish to Meta and pick it explicitly.`,
      candidates: pool,
    };
  }

  // No expected state. One exact match is the best we can do, but say which
  // region it landed in so a wrong one is visible rather than silent.
  if (exact.length === 1) {
    return {
      ok: true,
      key: exact[0].key,
      name: exact[0].name,
      region: exact[0].region,
      note: `No state on record for ${cityName}, so Meta's only exact match was used: ${exact[0].name}, ${exact[0].region}. Check that is the right one.`,
    };
  }

  return {
    ok: false,
    reason: `"${cityName}" matches ${pool.length} places on Meta and this app has no state on record to choose between them.`,
    candidates: pool,
  };
}
