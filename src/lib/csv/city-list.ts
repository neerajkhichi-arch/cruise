/**
 * A list of cities, uploaded as a CSV.
 *
 * Typing fifteen city names into an autocomplete is the wrong shape for a list
 * that arrives as a file, and retyping is where names get mangled — which in
 * this app means a campaign in the wrong state rather than a typo on a screen.
 *
 * Deliberately permissive about SHAPE and strict about CONTENT:
 *
 *   - header names are matched loosely, order does not matter, extra columns
 *     are ignored, and a file with no header row at all is read as one city per
 *     line. People paste from Excel, Sheets, email and Notepad, and refusing a
 *     file over its header is a refusal with no reason behind it;
 *   - every rejected row is returned WITH ITS LINE NUMBER AND A REASON. A
 *     thirty-city file that silently becomes twenty-six is the failure this is
 *     written to prevent. Nothing is dropped quietly.
 *
 * The row parser itself is shared with the lead-targets sheet rather than
 * written again. Two CSV parsers in one codebase drift, and the second one
 * always has the bug the first one already fixed.
 */

import { parseCsvWithLines } from "../sheets/lead-targets";

export interface CityRow {
  /** As typed in the file, trimmed. Never lower-cased — it is shown back. */
  cityName: string;
  /** Optional, and worth having: it settles Gurgaon vs Gurugram. */
  state: string | null;
  /** Distinguishes a second campaign in a city already running one. */
  label: string | null;
  /** 1-based line in the uploaded file, so a problem can be pointed at. */
  line: number;
}

export interface CityListResult {
  cities: CityRow[];
  /** Rows that could not be used, each with the line and why. */
  rejected: { line: number; raw: string; reason: string }[];
  /** Things worth saying that are not rejections. */
  notes: string[];
  /** True when the file had no recognisable header and was read as one city per line. */
  headerless: boolean;
}

const CITY_HEADERS = ["city", "cityname", "city name", "cities", "location", "town", "market"];
const STATE_HEADERS = ["state", "region", "province", "statename", "state name"];
const LABEL_HEADERS = ["label", "dealer", "variant", "suffix", "note"];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** A cell that is obviously a heading rather than a city. */
function looksLikeHeader(cells: string[]): boolean {
  return cells.some((c) => CITY_HEADERS.includes(norm(c)) || STATE_HEADERS.includes(norm(c)));
}

/**
 * Reject things that are not city names before they become Meta searches.
 * Each returns the reason shown against the row.
 */
function validateCityName(name: string): string | null {
  if (name.length < 2) return "Too short to be a city name.";
  if (name.length > 60) return "Too long to be a city name — is a whole address in this cell?";
  if (/^\d+$/.test(name)) return "This is a number, not a city name.";
  // A cell holding "Gurgaon, Haryana" means the file was split wrongly, or the
  // city and state were pasted into one column. Saying so beats searching Meta
  // for a string that will never match.
  if (name.includes(",")) {
    return "Contains a comma — city and state look like they ended up in one cell. Split them into two columns.";
  }
  if (/^(total|grand total|sum|n\/?a|-|–)$/i.test(name)) return "Looks like a totals or placeholder row.";
  return null;
}

export function parseCityList(csv: string): CityListResult {
  // Line-aware, and blank rows are dropped AFTER the line is recorded. Using
  // the filtered row index as a line number meant one blank line shifted every
  // message after it by one — so "rejected line 3" pointed at line 4 of the
  // operator's file, which is worse than saying nothing.
  const all = parseCsvWithLines(csv);
  const rows = all.filter((r) => r.cells.some((c) => c.trim() !== ""));
  const rejected: CityListResult["rejected"] = [];
  const notes: string[] = [];

  if (rows.length === 0) {
    return { cities: [], rejected: [], notes: ["The file is empty."], headerless: false };
  }

  const headerRow = looksLikeHeader(rows[0].cells);
  const headers = headerRow ? rows[0].cells.map(norm) : [];
  const body = headerRow ? rows.slice(1) : rows;

  let cityCol = headerRow ? headers.findIndex((h) => CITY_HEADERS.includes(h)) : 0;
  const stateCol = headerRow ? headers.findIndex((h) => STATE_HEADERS.includes(h)) : -1;
  const labelCol = headerRow ? headers.findIndex((h) => LABEL_HEADERS.includes(h)) : -1;

  if (headerRow && cityCol === -1) {
    // A header row that names a state but not a city. Rather than guess which
    // column holds cities, say what was found and what was wanted.
    return {
      cities: [],
      rejected: [],
      notes: [
        `No city column found. The header row reads: ${headers.filter(Boolean).join(", ")}. ` +
          `Name one column "city" (or ${CITY_HEADERS.slice(1).join(", ")}) and upload again.`,
      ],
      headerless: false,
    };
  }
  if (cityCol === -1) cityCol = 0;

  if (!headerRow) {
    notes.push("No header row was found, so the first column was read as the city name.");
  }
  if (headerRow && stateCol === -1) {
    notes.push(
      "No state column. Each city will be resolved on its name alone — fine for unambiguous names, but a state column is what prevents Gurgaon resolving to the village in Maharashtra rather than the city in Haryana."
    );
  }

  const cities: CityRow[] = [];
  const seen = new Map<string, number>();

  body.forEach(({ cells, line }) => {
    const raw = cells.join(",");
    const cityName = (cells[cityCol] ?? "").trim();

    if (!cityName) {
      rejected.push({ line, raw, reason: "No city in this row." });
      return;
    }

    const problem = validateCityName(cityName);
    if (problem) {
      rejected.push({ line, raw, reason: problem });
      return;
    }

    // A repeated city would produce two identical campaigns, or add the same
    // geo twice. Kept as a rejection rather than silently deduped, so the file
    // can be corrected at source.
    const key = cityName.toLowerCase();
    const firstAt = seen.get(key);
    if (firstAt !== undefined) {
      rejected.push({ line, raw, reason: `${cityName} already appears on line ${firstAt}.` });
      return;
    }
    seen.set(key, line);

    const state = stateCol >= 0 ? (cells[stateCol] ?? "").trim() : "";
    const label = labelCol >= 0 ? (cells[labelCol] ?? "").trim() : "";

    cities.push({
      cityName,
      state: state || null,
      label: label || null,
      line,
    });
  });

  if (cities.length === 0 && rejected.length > 0) {
    notes.push("No usable city in the file — every row was rejected for the reason shown against it.");
  }

  return { cities, rejected, notes, headerless: !headerRow };
}

/** The file to hand somebody who asks what the upload should look like. */
export const CITY_LIST_TEMPLATE = `city,state
Gurgaon,Haryana
Jaipur,Rajasthan
Lucknow,Uttar Pradesh
Indore,Madhya Pradesh
`;
