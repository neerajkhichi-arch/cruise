/**
 * Date ranges, in the ad account's timezone.
 *
 * This exists because of one fact: ad account 10153410655459601 reports in
 * Asia/Kolkata, and a range computed in UTC is 5½ hours behind it. For the
 * first 5½ hours of every Indian day, "today" in UTC is yesterday in Ads
 * Manager — and on the 1st of a month, a month-to-date range computed in UTC
 * silently includes the last few hours of the previous month. Numbers that
 * disagree with Ads Manager by a day's delivery are worse than no numbers,
 * because they look plausible.
 *
 * Meta's `time_range` parameter is interpreted in the account's timezone, so
 * the dates handed to it must be computed there too. Everything here works in
 * plain YYYY-MM-DD strings for that reason — no Date arithmetic across zones,
 * which is where this kind of bug usually hides.
 */

/** The ad account's reporting timezone. Overridable for a different account. */
export const ACCOUNT_TIMEZONE = process.env.NEXT_PUBLIC_META_TIMEZONE?.trim() || "Asia/Kolkata";

export type RangePreset =
  | "today"
  | "yesterday"
  | "last_7d"
  | "last_14d"
  | "last_30d"
  | "this_month"
  | "last_month"
  | "custom";

export interface DateRange {
  /** YYYY-MM-DD, inclusive. */
  since: string;
  /** YYYY-MM-DD, inclusive. */
  until: string;
  preset: RangePreset;
}

export const PRESET_LABELS: Record<RangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last_7d: "Last 7 days",
  last_14d: "Last 14 days",
  last_30d: "Last 30 days",
  this_month: "This month",
  last_month: "Last month",
  custom: "Custom",
};

/** Today's date in the account's timezone, as YYYY-MM-DD. */
export function todayInAccountTz(now = new Date(), timeZone = ACCOUNT_TIMEZONE): string {
  // en-CA gives YYYY-MM-DD, which avoids parsing a localised string back apart.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Shift a YYYY-MM-DD by whole days without touching timezones. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  const dt = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function startOfMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

export function endOfMonth(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${isoDate.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/** Resolve a preset against today in the account's timezone. */
export function resolvePreset(preset: Exclude<RangePreset, "custom">, now = new Date()): DateRange {
  const today = todayInAccountTz(now);
  switch (preset) {
    case "today":
      return { since: today, until: today, preset };
    case "yesterday": {
      const y = addDays(today, -1);
      return { since: y, until: y, preset };
    }
    case "last_7d":
      // Meta's "Last 7 days" ends yesterday — today is partial and moves while
      // you look at it. Matching that convention is the point of this file.
      return { since: addDays(today, -7), until: addDays(today, -1), preset };
    case "last_14d":
      return { since: addDays(today, -14), until: addDays(today, -1), preset };
    case "last_30d":
      return { since: addDays(today, -30), until: addDays(today, -1), preset };
    case "this_month":
      return { since: startOfMonth(today), until: today, preset };
    case "last_month": {
      const lastMonthDay = addDays(startOfMonth(today), -1);
      return { since: startOfMonth(lastMonthDay), until: endOfMonth(lastMonthDay), preset };
    }
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read a range out of URL search params, falling back to a preset.
 *
 * The range lives in the URL so a screen showing particular numbers can be
 * sent to somebody else and show the same numbers — which is most of the value
 * of having a range at all.
 */
export function rangeFromParams(
  params: { get(key: string): string | null },
  fallback: Exclude<RangePreset, "custom"> = "last_30d",
  now = new Date()
): DateRange {
  const since = params.get("since");
  const until = params.get("until");
  if (since && until && ISO.test(since) && ISO.test(until)) {
    // A backwards range is a typo, not an instruction. Swap rather than return
    // an empty result that reads as "no delivery".
    const [a, b] = since <= until ? [since, until] : [until, since];
    return { since: a, until: b, preset: "custom" };
  }
  const preset = params.get("preset") as RangePreset | null;
  if (preset && preset !== "custom" && preset in PRESET_LABELS) {
    return resolvePreset(preset as Exclude<RangePreset, "custom">, now);
  }
  return resolvePreset(fallback, now);
}

export function rangeToQuery(range: DateRange): string {
  const p = new URLSearchParams();
  if (range.preset === "custom") {
    p.set("since", range.since);
    p.set("until", range.until);
  } else {
    p.set("preset", range.preset);
  }
  return p.toString();
}

/** Inclusive day count, for "N days" labels. */
export function dayCount(range: DateRange): number {
  const [y1, m1, d1] = range.since.split("-").map(Number);
  const [y2, m2, d2] = range.until.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
}

/** "1–11 Sep 2026" / "1 Sep – 3 Oct 2026" / "11 Sep 2026". */
export function formatRange(range: DateRange): string {
  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(Date.UTC(y, m - 1, d));
  };
  if (range.since === range.until) return fmt(range.since, { day: "numeric", month: "short", year: "numeric" });
  const sameYear = range.since.slice(0, 4) === range.until.slice(0, 4);
  const sameMonth = sameYear && range.since.slice(0, 7) === range.until.slice(0, 7);
  if (sameMonth) {
    return `${fmt(range.since, { day: "numeric" })}–${fmt(range.until, { day: "numeric", month: "short", year: "numeric" })}`;
  }
  if (sameYear) {
    return `${fmt(range.since, { day: "numeric", month: "short" })} – ${fmt(range.until, { day: "numeric", month: "short", year: "numeric" })}`;
  }
  return `${fmt(range.since, { day: "numeric", month: "short", year: "numeric" })} – ${fmt(range.until, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

/** Clamp a custom range so nobody asks Meta for tomorrow. */
export function clampToToday(range: DateRange, now = new Date()): DateRange {
  const today = todayInAccountTz(now);
  return {
    ...range,
    since: range.since > today ? today : range.since,
    until: range.until > today ? today : range.until,
  };
}
