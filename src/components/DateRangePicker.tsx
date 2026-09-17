"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar, Check, ChevronDown } from "lucide-react";
import {
  ACCOUNT_TIMEZONE,
  DateRange,
  PRESET_LABELS,
  RangePreset,
  clampToToday,
  dayCount,
  formatRange,
  resolvePreset,
  todayInAccountTz,
} from "@/lib/date-range";
import { cn } from "@/lib/format";

/**
 * One date range control, used on every screen that shows numbers.
 *
 * It names the timezone. That is not decoration: this account reports in
 * Asia/Kolkata, the browser may be anywhere, and a range that silently means
 * something different from the one in Ads Manager is how two correct systems
 * end up disagreeing by a day's delivery.
 */

// This month first: budgets, lead targets and the P&L are all monthly, so the
// calendar month is the window almost every question is really about. The
// rolling windows stay available, below it.
const PRESETS: Exclude<RangePreset, "custom">[] = [
  "this_month",
  "last_month",
  "today",
  "yesterday",
  "last_7d",
  "last_14d",
  "last_30d",
];

export function DateRangePicker({
  value,
  onChange,
  className,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draftSince, setDraftSince] = useState(value.since);
  const [draftUntil, setDraftUntil] = useState(value.until);
  const boxRef = useRef<HTMLDivElement>(null);
  const today = todayInAccountTz();

  useEffect(() => {
    setDraftSince(value.since);
    setDraftUntil(value.until);
  }, [value.since, value.until]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function pick(preset: Exclude<RangePreset, "custom">) {
    onChange(resolvePreset(preset));
    setOpen(false);
  }

  function applyCustom() {
    if (!draftSince || !draftUntil) return;
    const [since, until] = draftSince <= draftUntil ? [draftSince, draftUntil] : [draftUntil, draftSince];
    onChange(clampToToday({ since, until, preset: "custom" }));
    setOpen(false);
  }

  const label = value.preset === "custom" ? formatRange(value) : PRESET_LABELS[value.preset];

  return (
    <div className={cn("relative", className)} ref={boxRef}>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Calendar className="h-4 w-4" />
        <span>{label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute right-0 z-30 mt-1.5 w-[300px] rounded-xl border border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-950 shadow-lg p-2"
        >
          <div className="space-y-0.5">
            {PRESETS.map((p) => {
              const active = value.preset === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => pick(p)}
                  className={cn(
                    "w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm text-left",
                    active
                      ? "bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300 font-medium"
                      : "text-ink-700 dark:text-ink-200 hover:bg-ink-50 dark:hover:bg-ink-900"
                  )}
                >
                  <span>{PRESET_LABELS[p]}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-[11px] text-ink-500 tabular-nums">{formatRange(resolvePreset(p))}</span>
                    {active && <Check className="h-3.5 w-3.5" />}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-2 pt-2 border-t border-ink-100 dark:border-ink-800">
            <p className="text-xs font-medium text-ink-700 dark:text-ink-200 mb-1.5 px-0.5">Custom</p>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                className="input !py-1.5 !text-xs flex-1"
                value={draftSince}
                max={today}
                onChange={(e) => setDraftSince(e.target.value)}
                aria-label="From"
              />
              <span className="text-xs text-ink-500">to</span>
              <input
                type="date"
                className="input !py-1.5 !text-xs flex-1"
                value={draftUntil}
                max={today}
                onChange={(e) => setDraftUntil(e.target.value)}
                aria-label="To"
              />
            </div>
            <button
              type="button"
              className="btn-secondary btn-sm !text-xs w-full mt-2 justify-center"
              onClick={applyCustom}
              disabled={!draftSince || !draftUntil}
            >
              Apply
            </button>
          </div>

          <p className="text-[11px] text-ink-500 mt-2 px-0.5 leading-relaxed">
            Dates are in <span className="font-mono">{ACCOUNT_TIMEZONE}</span>, the ad account&apos;s reporting
            timezone — set the same range in Ads Manager and the numbers line up.
          </p>
        </div>
      )}
    </div>
  );
}

/** The range, spelled out, for under a page title. */
export function RangeCaption({ range }: { range: DateRange }) {
  const days = dayCount(range);
  return (
    <span className="text-ink-500">
      {formatRange(range)} · {days} day{days === 1 ? "" : "s"} · {ACCOUNT_TIMEZONE}
    </span>
  );
}
