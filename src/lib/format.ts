/**
 * Currency, with enough precision to be true.
 *
 * `inr` rounds to whole rupees, which is right for spend and CPL but destroys
 * CPC — this account runs ₹0.63 to ₹1.58 a click, and all of that renders as
 * "₹1". Use this wherever a value can legitimately sit under ₹10.
 */
export function inrPrecise(n: number): string {
  if (n === 0) return "₹0";
  if (Math.abs(n) < 10) return `₹${n.toFixed(2)}`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function inr(n: number, opts: { compact?: boolean } = {}): string {
  if (opts.compact) {
    if (Math.abs(n) >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
    if (Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    if (Math.abs(n) >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
    return `₹${Math.round(n)}`;
  }
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function num(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

export function pct(n: number, opts: { signed?: boolean } = {}): string {
  const sign = opts.signed && n > 0 ? "+" : "";
  return `${sign}${n.toFixed(0)}%`;
}

export function pctPrecise(n: number, opts: { signed?: boolean } = {}): string {
  const sign = opts.signed && n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function cn(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}
