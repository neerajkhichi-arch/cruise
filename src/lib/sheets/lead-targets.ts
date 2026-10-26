/**
 * Monthly lead targets, read from a published Google Sheet.
 *
 * "Publish to web → CSV" gives a plain URL with no credentials, which is why it
 * was chosen over a service account: it works today rather than after another
 * access request. The trade is that anyone holding the URL can read that tab,
 * so the sheet must contain city names and numbers and nothing else. The app
 * never writes back — the sheet is the input, and the record of what was paused
 * lives here.
 *
 * The parser is deliberately forgiving about headers and strict about numbers.
 * A mistyped header should not silently produce a target of zero, which would
 * read as "every city is over target" and invite pausing the whole account.
 */

export interface LeadTarget {
  cityName: string;
  /**
   * Leads wanted this month, or null when the sheet gives none.
   *
   * This was mandatory at first, which was wrong: a row with a budget and no
   * lead goal is a normal thing to want, and rejecting it threw the WHOLE row
   * away — budget included. The sheet then read as empty and the enforcement
   * skipped everything while looking like it was working.
   */
  target: number | null;
  /**
   * Rupees this city may spend this month, when the sheet says so.
   *
   * Null means no budget was given, not a budget of zero — the difference
   * matters, because zero would read as "already exhausted" and stop the city.
   */
  budget: number | null;
  /** The row this came from, for error messages. */
  row: number;
}

export interface LeadTargetsResult {
  targets: LeadTarget[];
  /** Rows that could not be read, with the reason. Never silently dropped. */
  problems: string[];
  fetchedAt: string;
  sourceUrl: string;
}

/** Header spellings seen in the wild, lowercased and stripped of punctuation. */
const CITY_HEADERS = ["city", "cityname", "city name", "location", "market"];
const BUDGET_HEADERS = [
  "budget",
  "monthly budget",
  "monthlybudget",
  "month budget",
  "spend",
  "spend limit",
  "spendlimit",
  "budget cap",
  "cap",
];
/**
 * A sheet that splits one combined budget across channels (e.g. a "Monthly
 * Budget" total alongside a per-channel "Meta" column) must be read from the
 * Meta-specific column, not the total — this app only ever talks to Meta, and
 * using the combined total as the spend ceiling would let a city's Meta spend
 * run into the share meant for Google before enforcement ever triggers.
 */
const META_BUDGET_HEADERS = ["meta", "meta budget", "metabudget", "meta spend", "meta monthly budget"];
const TARGET_HEADERS = [
  "target",
  "leadtarget",
  "lead target",
  "targetleads",
  "target leads",
  "monthlytarget",
  "monthly target",
  "leads",
  "leadgoal",
  "goal",
];

function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ");
}

/**
 * A CSV parser that handles quoted fields, because a city list will eventually
 * contain "Nashik, Maharashtra" and splitting on commas would quietly shift
 * every column one to the right.
 *
 * Rows carry the line they START on, counted in the original text. That matters
 * for any message of the form "line 14 was rejected": blank lines and multi-line
 * quoted fields both mean a row's position in this array is NOT its line number
 * in the file, and pointing somebody at the wrong line is worse than not
 * pointing at all.
 */
export function parseCsvWithLines(text: string): { cells: string[]; line: number }[] {
  const rows: { cells: string[]; line: number }[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        // A newline inside quotes is part of the value, and still a line.
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push({ cells: row, line: rowLine });
      row = [];
      field = "";
      line++;
      rowLine = line;
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push({ cells: row, line: rowLine });
  }
  return rows;
}

/** The same parse, blank rows dropped and line numbers discarded. */
export function parseCsv(text: string): string[][] {
  return parseCsvWithLines(text)
    .map((r) => r.cells)
    .filter((r) => r.some((c) => c.trim() !== ""));
}

/** Numbers arrive as "1,200", "1200 ", "1200.0". None of those should fail. */
function parseTargetNumber(raw: string): number | null {
  const cleaned = raw.replace(/[,\s₹]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

export function parseLeadTargets(csv: string): { targets: LeadTarget[]; problems: string[] } {
  const rows = parseCsv(csv);
  const problems: string[] = [];
  if (rows.length < 2) {
    return { targets: [], problems: ["The sheet has no data rows — check the published range."] };
  }

  const headers = rows[0].map(normaliseHeader);
  const cityCol = headers.findIndex((h) => CITY_HEADERS.includes(h));
  const targetCol = headers.findIndex((h) => TARGET_HEADERS.includes(h));
  // Budget is optional: a sheet with only City and Target still works, and the
  // cities without one simply have no spend ceiling.
  //
  // A Meta-specific column, when the sheet has one, wins over a generic
  // "budget"/"monthly budget"/"spend" column — see META_BUDGET_HEADERS above.
  const metaBudgetCol = headers.findIndex((h) => META_BUDGET_HEADERS.includes(h));
  const genericBudgetCol = headers.findIndex((h) => BUDGET_HEADERS.includes(h));
  const budgetCol = metaBudgetCol !== -1 ? metaBudgetCol : genericBudgetCol;

  if (cityCol === -1 || (targetCol === -1 && budgetCol === -1)) {
    return {
      targets: [],
      problems: [
        `Could not find the columns. Found headers: ${rows[0].join(", ") || "(none)"}. ` +
          `The sheet needs a City column plus at least one of Target or Monthly Budget.`,
      ],
    };
  }

  const targets: LeadTarget[] = [];
  const seen = new Map<string, number>();

  rows.slice(1).forEach((r, i) => {
    const rowNumber = i + 2; // 1-indexed, plus the header
    const cityName = (r[cityCol] ?? "").trim();
    const rawTarget = targetCol === -1 ? "" : (r[targetCol] ?? "").trim();
    const rawBudget = budgetCol === -1 ? "" : (r[budgetCol] ?? "").trim();
    if (!cityName && !rawTarget && !rawBudget) return;

    if (!cityName) {
      problems.push(`Row ${rowNumber}: numbers with no city name.`);
      return;
    }
    // An unquoted "1,200" is two CSV fields, and the first of them parses
    // perfectly well as 1 — a target of 1 means the city reads as over target
    // the moment it gets a single lead, and gets paused. Google's own export
    // quotes such values, so this only happens in a hand-made file, but the
    // cost of guessing wrong is a market switched off. Refuse and say why.
    const next = (r[targetCol + 1] ?? "").trim();
    if (/^\d{1,3}$/.test(rawTarget) && /^\d{3}$/.test(next)) {
      problems.push(
        `Row ${rowNumber}: ${cityName}'s target reads as "${rawTarget},${next}" split across two columns — ` +
          `a thousands separator outside quotes. Remove the comma (${rawTarget}${next}) and refresh.`
      );
      return;
    }

    // A blank target is allowed — the city simply has no lead goal. A target
    // that is present but unreadable is reported and dropped, without taking
    // the row's budget down with it.
    let target: number | null = null;
    if (rawTarget) {
      const parsed = parseTargetNumber(rawTarget);
      if (parsed === null) {
        problems.push(`Row ${rowNumber}: ${cityName}'s target "${rawTarget}" is not a number, so no lead goal was applied.`);
      } else if (parsed === 0) {
        problems.push(`Row ${rowNumber}: ${cityName}'s target is 0 — ignored, since that would read as permanently over target.`);
      } else {
        target = parsed;
      }
    }

    const key = cityName.toLowerCase();
    if (seen.has(key)) {
      problems.push(`Row ${rowNumber}: ${cityName} appears twice. The first row is used and this one ignored.`);
      return;
    }
    let budget: number | null = null;
    {
      if (rawBudget) {
        const nextB = (r[budgetCol + 1] ?? "").trim();
        if (/^\d{1,3}$/.test(rawBudget) && /^\d{3}$/.test(nextB)) {
          problems.push(
            `Row ${rowNumber}: ${cityName}'s budget reads as "${rawBudget},${nextB}" split across two columns — ` +
              `a thousands separator outside quotes. Remove the comma (${rawBudget}${nextB}) and refresh.`
          );
        } else {
          const parsed = parseTargetNumber(rawBudget);
          if (parsed === null) {
            problems.push(
              `Row ${rowNumber}: ${cityName}'s budget "${rawBudget}" is not a number, so no spend ceiling was applied.`
            );
          } else if (parsed === 0) {
            problems.push(
              `Row ${rowNumber}: ${cityName}'s budget is 0 — ignored, since that would read as already exhausted.`
            );
          } else {
            budget = parsed;
          }
        }
      }
    }

    // A row that ended up with neither number controls nothing. Say so rather
    // than carrying a city that can never trigger anything.
    if (target === null && budget === null) {
      problems.push(`Row ${rowNumber}: ${cityName} has neither a target nor a budget, so nothing governs it.`);
      return;
    }

    seen.set(key, target ?? 0);
    targets.push({ cityName, target, budget, row: rowNumber });
  });

  return { targets, problems };
}

/**
 * Turn whatever Google Sheets URL was pasted into one that returns CSV.
 *
 * Operators paste the address bar URL far more often than the published-CSV
 * one. Rewriting it is kinder than refusing, and unambiguous: the document id
 * and the gid are the only parts that matter.
 */
export function toCsvUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/output=csv|\/export\?/.test(trimmed)) return trimmed;

  const id = trimmed.match(/\/spreadsheets\/d\/(?:e\/)?([a-zA-Z0-9-_]+)/)?.[1];
  if (!id) return null;
  const gid = trimmed.match(/[#&?]gid=(\d+)/)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

/**
 * The sheet for ONE ad account.
 *
 * The URL is required. It used to fall back to LEAD_TARGETS_CSV_URL when a
 * caller passed nothing, which was fine on a single-account install and
 * actively wrong once there were five: an account with no sheet of its own
 * silently inherited CarDekho's used-car targets and monthly budgets, and the
 * Executive Dashboard showed those numbers under every account's name. A
 * missing sheet has to read as missing.
 *
 * The environment value is not lost - lib/accounts.ts seeds it onto the ad
 * account it actually belongs to, so that account still finds it here.
 */
export async function fetchLeadTargets(rawUrl?: string | null): Promise<LeadTargetsResult> {
  const configured = rawUrl?.trim();
  if (!configured) {
    throw new Error(
      "This ad account has no lead-target sheet. Targets and monthly budgets are set per account, so there is " +
        "nothing to enforce or report against until one is given. Publish the sheet (File → Share → Publish to web " +
        "→ CSV) and paste the URL against this account in Settings → Ad accounts."
    );
  }
  const url = toCsvUrl(configured);
  if (!url) {
    throw new Error(`"${configured}" is not a Google Sheets URL. Use the sheet's address or its published CSV link.`);
  }

  const res = await fetch(url, { cache: "no-store", redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `The sheet returned HTTP ${res.status}. If it is 401 or 404 the sheet is not published — File → Share → Publish to web → CSV.`
    );
  }
  const text = await res.text();

  // A sheet that is shared-by-link but not PUBLISHED returns an HTML sign-in
  // page with a 200, which would otherwise parse as a single nonsense row.
  if (/^\s*<!DOCTYPE html|^\s*<html/i.test(text)) {
    throw new Error(
      "That URL returned a web page, not CSV — the sheet is link-shared but not published. Use File → Share → Publish to web → CSV."
    );
  }

  const { targets, problems } = parseLeadTargets(text);
  return { targets, problems, fetchedAt: new Date().toISOString(), sourceUrl: url };
}
