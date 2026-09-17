"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/format";

/**
 * Picking one thing out of hundreds.
 *
 * A native <select> listing 250 campaigns is not a control, it is a hazard: the
 * account manager cannot search it, the names differ by a date at the end
 * ("Chennai Web Conversion 030216" next to "030316"), and the operating system
 * renders it as an unstyled overlay that hides the rest of the form. Choosing
 * the wrong row there is one arrow key away and adds cities to a live campaign
 * nobody meant to touch.
 *
 * So: type to filter, live count, active items first, and every row carries the
 * facts you would otherwise have to leave the page to check — status, ad sets,
 * daily budget. The chosen item stays on screen after the list closes, because
 * the most common mistake is not picking wrongly, it is not noticing what was
 * picked.
 */

export interface SearchOption {
  id: string;
  label: string;
  /** A second line — what this row is, in the operator's terms. */
  sublabel?: string;
  /** Short facts shown as chips: status, counts, budget. */
  chips?: { text: string; tone?: "positive" | "caution" | "neutral" }[];
  /** Rows in the first group are listed first, under this heading. */
  group?: string;
  /** Extra words that should match the search but are not displayed. */
  keywords?: string;
}

export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "Search…",
  emptyText = "Nothing matches that.",
  label,
  hint,
  disabled,
}: {
  options: SearchOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  emptyText?: string;
  label?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? options.filter(
          (o) =>
            o.label.toLowerCase().includes(q) ||
            (o.sublabel ?? "").toLowerCase().includes(q) ||
            (o.keywords ?? "").toLowerCase().includes(q)
        )
      : options;

    // Grouped items first, in the order the caller listed the groups. Beyond
    // that the caller's order is preserved — re-sorting a list someone has
    // learned the shape of is its own kind of unhelpful.
    const groups: string[] = [];
    for (const o of rows) {
      const g = o.group ?? "";
      if (!groups.includes(g)) groups.push(g);
    }
    return groups.map((g) => ({ group: g, rows: rows.filter((o) => (o.group ?? "") === g) }));
  }, [options, query]);

  const flat = useMemo(() => filtered.flatMap((g) => g.rows), [filtered]);

  useEffect(() => setCursor(0), [query, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = flat[cursor];
      if (hit) choose(hit.id);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  let index = -1;

  return (
    <div>
      {label && <label className="label">{label}</label>}

      <div className="relative" ref={boxRef}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            open ? "border-brand-600 ring-1 ring-brand-600" : "border-ink-200 hover:border-ink-300",
            selected ? "bg-white" : "bg-white text-ink-400"
          )}
        >
          <span className="min-w-0 flex-1">
            {selected ? (
              <>
                <span className="block truncate font-medium text-ink-900">{selected.label}</span>
                {selected.sublabel && (
                  <span className="block truncate text-xs text-ink-500">{selected.sublabel}</span>
                )}
              </>
            ) : (
              placeholder
            )}
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-ink-400 transition-transform", open && "rotate-180")} />
        </button>

        {open && (
          <div className="absolute z-40 mt-1 w-full rounded-xl border border-ink-200 bg-white shadow-lift overflow-hidden">
            <div className="flex items-center gap-2 border-b border-ink-100 px-3">
              <Search className="h-4 w-4 text-ink-400 shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Type to search…"
                className="w-full py-2.5 text-sm outline-none placeholder:text-ink-400"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} className="text-ink-400 hover:text-ink-700">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
              {flat.length === 0 && <p className="px-3 py-6 text-sm text-ink-500 text-center">{emptyText}</p>}

              {filtered.map(({ group, rows }) => (
                <div key={group || "_"}>
                  {group && (
                    <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                      {group}
                    </p>
                  )}
                  {rows.map((o) => {
                    index += 1;
                    const active = index === cursor;
                    const chosen = o.id === value;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        data-cursor={active ? "true" : undefined}
                        onMouseEnter={() => setCursor(flat.findIndex((f) => f.id === o.id))}
                        onClick={() => choose(o.id)}
                        className={cn(
                          "w-full text-left px-3 py-2",
                          active ? "bg-brand-50" : "hover:bg-ink-50"
                        )}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-ink-900 truncate">{o.label}</span>
                            {o.sublabel && <span className="block text-xs text-ink-500 truncate">{o.sublabel}</span>}
                            {o.chips && o.chips.length > 0 && (
                              <span className="flex flex-wrap gap-1 mt-1">
                                {o.chips.map((c, i) => (
                                  <span
                                    key={i}
                                    className={cn(
                                      "chip !text-[10px]",
                                      c.tone === "positive"
                                        ? "chip-positive"
                                        : c.tone === "caution"
                                          ? "chip-caution"
                                          : "chip-neutral"
                                    )}
                                  >
                                    {c.text}
                                  </span>
                                ))}
                              </span>
                            )}
                          </span>
                          {chosen && <Check className="h-4 w-4 text-brand-600 shrink-0 mt-0.5" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="border-t border-ink-100 px-3 py-1.5 text-[11px] text-ink-400">
              {flat.length} of {options.length} shown · ↑↓ to move, Enter to choose
            </div>
          </div>
        )}
      </div>

      {hint && <p className="text-xs text-ink-500 mt-1.5">{hint}</p>}
    </div>
  );
}
