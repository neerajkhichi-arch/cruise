"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Users2 } from "lucide-react";
import { cn, inr } from "@/lib/format";

/**
 * Picking existing Meta audiences for a replication batch.
 *
 * Two things this deliberately does NOT do:
 *
 * It does not let you target an audience Meta says is too small. An ad set
 * built on a 200-person audience is created, approved, and then delivers
 * nothing — a failure that is invisible until somebody wonders about the zero.
 * The option is shown, disabled, with Meta's own reason next to it, rather than
 * hidden: "why isn't my audience in the list" should have an answer.
 *
 * It does not apply a targeted audience to the broad campaign. Targeting an
 * audience turns a prospecting buy into a remarketing one, which is a different
 * campaign with a different cost per lead — so it goes into a second campaign,
 * named and budgeted separately, rather than quietly changing what the first
 * one is. Exclusions are the opposite case and ride along on the broad buy,
 * with no size floor, because removing people from a large audience is safe at
 * any size.
 */

export interface AudienceRow {
  id: string;
  name: string;
  subtype: string | null;
  sizeLower: number | null;
  sizeUpper: number | null;
  /** False when Meta withheld the size — never print the placeholder as fact. */
  sizeDisclosed: boolean;
  deliveryDescription: string | null;
  targetable: boolean;
  reason: string | null;
}

type Mode = "off" | "target" | "exclude";

function sizeLabel(a: AudienceRow): string {
  const fmt = (n: number) => n.toLocaleString("en-IN");
  // Meta reports exactly 1000-1000 when it will not disclose a size. Printing
  // "1,000 people" there would be a made-up number: this account's 1% India
  // lookalike of a 100,000-person seed reports that, and is far larger.
  if (!a.sizeDisclosed) return "size not disclosed";
  if (a.sizeLower !== null && a.sizeUpper !== null) {
    return a.sizeLower === a.sizeUpper ? `${fmt(a.sizeLower)} people` : `${fmt(a.sizeLower)}–${fmt(a.sizeUpper)}`;
  }
  if (a.sizeUpper !== null) return `under ${fmt(a.sizeUpper)}`;
  if (a.sizeLower !== null) return `over ${fmt(a.sizeLower)}`;
  return "size unknown";
}

export function AudienceSelector({
  include,
  exclude,
  onChange,
  twinEnabled,
  twinBudget,
  onTwinChange,
  broadBudget,
  cityCount,
}: {
  include: string[];
  exclude: string[];
  onChange: (include: string[], exclude: string[]) => void;
  twinEnabled: boolean;
  twinBudget: string;
  onTwinChange: (enabled: boolean, budget: string) => void;
  broadBudget: number;
  cityCount: number;
}) {
  const [rows, setRows] = useState<AudienceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  // Fetched when the panel is OPENED, not when the page mounts.
  //
  // Mounting the fetch meant simply visiting Replicate paged through every
  // custom audience in the account, whether or not you intended to use one.
  // Meta rate-limits per ad account, so that read competed with the reporting
  // screens and with publishing itself — and it did, within an hour of shipping.
  useEffect(() => {
    if (!open || rows || error) return;
    let cancelled = false;
    fetch("/api/audiences")
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) setError(body.error ?? "Could not read your audiences.");
        else setRows(body.audiences ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Could not reach the server.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, rows, error]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows ?? [];
    return (rows ?? []).filter((a) => a.name.toLowerCase().includes(q));
  }, [rows, search]);

  const modeOf = (id: string): Mode =>
    include.includes(id) ? "target" : exclude.includes(id) ? "exclude" : "off";

  function setMode(id: string, mode: Mode) {
    const nextIncl = include.filter((x) => x !== id);
    const nextExcl = exclude.filter((x) => x !== id);
    if (mode === "target") nextIncl.push(id);
    if (mode === "exclude") nextExcl.push(id);
    onChange(nextIncl, nextExcl);
    // Turning off the last targeted audience makes a remarketing campaign
    // meaningless — it would be a second broad campaign bidding against the
    // first in the same city. So it switches itself off rather than being left
    // armed and empty.
    if (mode !== "target" && nextIncl.length === 0 && twinEnabled) onTwinChange(false, twinBudget);
  }

  const chosen = include.length + exclude.length;
  const twinSpend = Number(twinBudget) || 0;

  return (
    <div className="rounded-xl border border-ink-200 dark:border-ink-800">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-3 p-3.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <Users2 className="h-4 w-4 text-ink-400" />
          <span className="text-sm font-medium text-ink-900 dark:text-ink-50">Existing Meta audiences</span>
          {chosen > 0 && (
            <span className="chip chip-neutral !text-[11px]">
              {include.length > 0 && `${include.length} targeted`}
              {include.length > 0 && exclude.length > 0 && " · "}
              {exclude.length > 0 && `${exclude.length} excluded`}
            </span>
          )}
        </span>
        <span className="text-xs text-ink-500">{open ? "Hide" : "Optional — choose"}</span>
      </button>

      {open && (
        <div className="border-t border-ink-200 dark:border-ink-800 p-3.5 space-y-3">
          {error && (
            <p className="text-xs text-negative">
              {error} Audiences are read live from Meta — there is no remembered list, because picking one that has
              since been deleted would only fail later.
            </p>
          )}
          {!rows && !error && <div className="h-20 rounded bg-ink-100 dark:bg-ink-800 animate-pulse" />}

          {rows && rows.length === 0 && (
            <p className="text-xs text-ink-500">This ad account has no custom audiences.</p>
          )}

          {rows && rows.length > 0 && (
            <>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
                <input
                  className="input pl-8"
                  placeholder="Search audiences…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
                {filtered.map((a) => {
                  const mode = modeOf(a.id);
                  return (
                    <div
                      key={a.id}
                      className={cn(
                        "rounded-lg border p-2.5",
                        mode === "target"
                          ? "border-brand-500 bg-brand-50/60 dark:bg-brand-950/40"
                          : mode === "exclude"
                            ? "border-caution/50 bg-caution/5"
                            : "border-ink-200 dark:border-ink-800"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-ink-900 dark:text-ink-50 truncate">{a.name}</p>
                          <p className="text-[11px] text-ink-500">
                            {sizeLabel(a)}
                            {a.subtype && <> · {a.subtype.toLowerCase()}</>}
                          </p>
                        </div>
                        <div className="flex shrink-0 rounded-lg border border-ink-200 dark:border-ink-700 overflow-hidden">
                          {(["off", "target", "exclude"] as Mode[]).map((m) => {
                            const disabled = m === "target" && !a.targetable;
                            return (
                              <button
                                key={m}
                                type="button"
                                disabled={disabled}
                                title={disabled ? a.reason ?? "Too small to target" : undefined}
                                onClick={() => setMode(a.id, m)}
                                className={cn(
                                  "px-2.5 py-1 text-[11px] capitalize",
                                  mode === m
                                    ? m === "target"
                                      ? "bg-brand-600 text-white"
                                      : m === "exclude"
                                        ? "bg-caution text-white"
                                        : "bg-ink-200 dark:bg-ink-700 text-ink-800 dark:text-ink-100"
                                    : "text-ink-500 hover:bg-ink-50 dark:hover:bg-ink-900",
                                  disabled && "opacity-40 cursor-not-allowed"
                                )}
                              >
                                {m}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {/* Shown, not hidden — "why isn't my audience here" should
                          have an answer other than silence. */}
                      {!a.targetable && a.reason && (
                        <p className="text-[11px] text-caution mt-1.5">
                          Cannot be targeted: {a.reason} It can still be excluded.
                        </p>
                      )}
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <p className="text-xs text-ink-500 py-3 text-center">No audience matches “{search}”.</p>
                )}
              </div>
            </>
          )}

          {include.length > 0 && (
            <div className="rounded-lg border border-brand-300 dark:border-brand-800 bg-brand-50/60 dark:bg-brand-950/30 p-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-brand-600"
                  checked={twinEnabled}
                  onChange={(e) => onTwinChange(e.target.checked, twinBudget)}
                />
                <span>
                  <span className="text-sm font-medium text-ink-900 dark:text-ink-50">
                    Also create a second campaign per city targeting {include.length === 1 ? "this audience" : "these audiences"}
                  </span>
                  <span className="block text-xs text-ink-600 dark:text-ink-300 mt-0.5">
                    Named <span className="font-mono">… | LAUNCH | REMARKETING</span>, with its own budget. The broad
                    campaign is left broad — targeting an audience would make it a different kind of buy, and its cost
                    per lead would stop being comparable with every other city.
                  </span>
                </span>
              </label>

              {twinEnabled && (
                <div className="mt-3 pl-7">
                  <label className="label">Daily budget for the remarketing campaign, per city</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="input max-w-[200px]"
                    value={twinBudget}
                    placeholder="500"
                    onChange={(e) => onTwinChange(true, e.target.value.replace(/[^\d.]/g, ""))}
                  />
                  {twinSpend > 0 && cityCount > 0 && (
                    <p className="text-xs text-ink-600 dark:text-ink-300 mt-1.5">
                      Each city commits {inr(broadBudget)} broad + {inr(twinSpend)} remarketing ={" "}
                      <span className="font-medium">{inr(broadBudget + twinSpend)}/day</span>. Across {cityCount}{" "}
                      {cityCount === 1 ? "city" : "cities"}: {inr((broadBudget + twinSpend) * cityCount)}/day.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {exclude.length > 0 && (
            <p className="text-xs text-ink-500">
              {exclude.length === 1 ? "The excluded audience is" : "Excluded audiences are"} applied to every campaign
              in this batch, including the remarketing one. No size floor applies to an exclusion.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
