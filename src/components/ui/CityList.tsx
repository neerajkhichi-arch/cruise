"use client";

import { useState } from "react";

/**
 * A campaign's cities, in one line until asked otherwise.
 *
 * A multi-city campaign can carry two hundred places, and printing them all
 * turned one table row into a page and a half of scrolling — the row's actual
 * numbers ended up somewhere below the fold, which is the opposite of what a
 * table is for. Three names and a count say what kind of campaign this is; the
 * full list is one click away for the times it matters.
 *
 * The count is part of the summary, not decoration: "Ahmedabad, Pune, Jaipur"
 * on its own would read as a three-city campaign.
 */
export function CityList({ cities, preview = 3 }: { cities: string[]; preview?: number }) {
  const [open, setOpen] = useState(false);

  if (cities.length === 0) return <span className="text-ink-400">—</span>;
  if (cities.length <= preview) return <span>{cities.join(", ")}</span>;

  const hidden = cities.length - preview;

  return (
    <span className="inline-block max-w-[260px] align-top">
      {open ? (
        <span className="block max-h-40 overflow-y-auto leading-relaxed">{cities.join(", ")}</span>
      ) : (
        <span className="block truncate">{cities.slice(0, preview).join(", ")}</span>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-brand-700 hover:underline mt-0.5"
        title={open ? undefined : cities.join(", ")}
      >
        {open ? "Show less" : `+${hidden} more`}
      </button>
    </span>
  );
}
