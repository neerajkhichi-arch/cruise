/**
 * What this ad account actually reports as a conversion.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * "Which pixel event counts as a lead here" was a free-text box. Typing the
 * wrong value into it does not produce an error — it produces a lead count of
 * zero, which is indistinguishable from a month in which nothing converted.
 * That is the worst possible failure mode for a settings field: silent, and
 * wearing the costume of a real answer.
 *
 * Meta already knows. Every insights row carries the action types that fired,
 * with their counts. So rather than asking someone to remember the exact
 * spelling of an event defined in another tool, this reads the last 30 days and
 * reports what the account genuinely produced. The setting becomes a choice
 * from a list of real things rather than a guess.
 *
 * Nothing here decides which one is right — a person does. The ranking only
 * puts the plausible candidates first.
 * ---------------------------------------------------------------------------
 */

import { actPath, graphGet } from "./graph";
import { TTL, cached } from "./cache";
import { addDays, todayInAccountTz } from "../date-range";

export interface LeadActionCandidate {
  /** The exact action_type string, ready to be stored against the account. */
  actionType: string;
  /** How it reads to a person: the custom event name, or a tidied label. */
  label: string;
  /** Total over the window. */
  count: number;
  /** True when this is the sort of action a lead is usually counted by. */
  likelyLead: boolean;
}

export interface LeadActionsResult {
  since: string;
  until: string;
  candidates: LeadActionCandidate[];
  /** Whatever the account is set to today, so the UI can mark it. */
  current: string | null;
  notes: string[];
}

interface Row {
  actions?: { action_type: string; value: string }[];
  conversions?: { action_type: string; value: string }[];
}

const CUSTOM_PREFIX = "offsite_conversion.fb_pixel_custom.";

/**
 * Action types a lead is plausibly counted by.
 *
 * Deliberately generous: being on this list only affects ordering, and a
 * missing entry would push the right answer down the page rather than hide it.
 */
function isLikelyLead(actionType: string): boolean {
  const t = actionType.toLowerCase();
  if (t.startsWith(CUSTOM_PREFIX)) return true; // a custom event, by definition deliberate
  return (
    t.includes("lead") ||
    t.includes("complete_registration") ||
    t.includes("submit_application") ||
    t.includes("contact") ||
    t.includes("schedule") ||
    t.includes("subscribe")
  );
}

/** A name a person can read, without losing the exact value underneath. */
function labelFor(actionType: string): string {
  if (actionType.startsWith(CUSTOM_PREFIX)) return actionType.slice(CUSTOM_PREFIX.length);
  if (actionType === "offsite_conversion.fb_pixel_lead") return "Website pixel — standard Lead event";
  if (actionType === "leadgen.other") return "Instant form on Facebook (lead form)";
  if (actionType === "onsite_conversion.lead_grouped") return "On-Facebook leads (grouped)";
  return actionType;
}

/**
 * Every conversion action this account reported in the window, with totals.
 *
 * Custom pixel events arrive in `conversions` and standard ones in `actions`,
 * and an account can use both, so the two are merged. Reading only `actions` is
 * the same mistake that once made every city report zero leads for a week.
 */
export async function discoverLeadActions(
  adAccountId: string,
  current: string | null,
  days = 30
): Promise<LeadActionsResult> {
  const until = addDays(todayInAccountTz(), -1);
  const since = addDays(until, -(days - 1));

  const rows = await cached(`leadactions:${adAccountId}:${since}:${until}`, TTL.insights, async () => {
    const body = await graphGet<{ data: Row[] }>(actPath(adAccountId, "insights"), {
      level: "account",
      fields: "actions,conversions",
      time_range: JSON.stringify({ since, until }),
      limit: "500",
    });
    return body.data ?? [];
  });

  const totals = new Map<string, number>();
  for (const row of rows) {
    for (const a of [...(row.conversions ?? []), ...(row.actions ?? [])]) {
      const value = Number(a.value) || 0;
      if (value <= 0) continue;
      // An action type can appear in both arrays for the same row; the larger
      // of the two is the account's own count, not the sum of a double read.
      totals.set(a.action_type, Math.max(totals.get(a.action_type) ?? 0, value));
    }
  }

  const candidates: LeadActionCandidate[] = [...totals.entries()]
    .map(([actionType, count]) => ({
      actionType,
      label: labelFor(actionType),
      count,
      likelyLead: isLikelyLead(actionType),
    }))
    // Plausible lead actions first, then by volume. Volume alone would put
    // link clicks and impressions-adjacent actions above the thing being asked
    // about.
    .sort((a, b) => (a.likelyLead === b.likelyLead ? b.count - a.count : a.likelyLead ? -1 : 1));

  const notes: string[] = [];
  if (candidates.length === 0) {
    notes.push(
      `This account reported no conversions at all between ${since} and ${until}. Either nothing converted in that ` +
        `window, or the pixel is not sending events to this ad account — in both cases there is nothing to choose ` +
        `from yet.`
    );
  } else if (!candidates.some((c) => c.likelyLead)) {
    notes.push(
      "None of the actions this account reported look like a lead event. The list below is everything it did " +
        "report, in case the lead is being recorded under a name this app does not recognise."
    );
  }
  if (current && !totals.has(current)) {
    notes.push(
      `The account is currently set to "${current}", which did not fire once in this window. That is why every lead ` +
        `figure for this account reads zero.`
    );
  }

  return { since, until, candidates, current, notes };
}
