"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, MapPin, Search } from "lucide-react";
import { useFetch } from "@/lib/useFetch";
import { inr, num, cn } from "@/lib/format";
import { DeltaChip } from "@/components/ui/DeltaChip";
import { DateRangePicker, RangeCaption } from "@/components/DateRangePicker";
import { DateRange, rangeToQuery, resolvePreset } from "@/lib/date-range";

/**
 * City performance, from Meta, for the selected range.
 *
 * The table this replaces showed Ahmedabad with spend ₹0, leads 0 and a cost
 * per lead of ₹30. Those three cannot all be true; the row came from the seeded
 * local tables. It also listed Delhi NCR, Jaipur and Noida, which this ad
 * account does not target, and a "WoW CPL" computed from data that had not
 * moved since 2026-09-01.
 *
 * Four columns are gone rather than carried over. Qualified, CPQL, Conversion
 * Rate and Sales are CRM stages — they describe what happens to a lead after
 * Meta hands it over, and nothing in this app is connected to a system that
 * knows. Meta reports spend, leads, CPL, impressions, clicks, CTR and CPC, so
 * that is what the table shows. Inventory comes from the Meta catalogue, which
 * is the only inventory that can actually be advertised.
 *
 * "vs previous" compares against the equal-length window immediately before the
 * selected range — not a fixed week — so the comparison still means something
 * when you pick eleven days or a calendar month.
 */

interface CityRow {
  cityName: string;
  targetedAs: string[];
  adSetCount: number;
  activeAdSetCount: number;
  campaignIds: string[];
  dailyBudget: number;
  spend: number;
  leads: number;
  cpl: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  previousSpend: number;
  previousLeads: number;
  previousCpl: number;
  cplChangePct: number | null;
  inventory: number | null;
}

interface Payload {
  range: { since: string; until: string };
  previous: { since: string; until: string };
  days: number;
  cities: CityRow[];
  unattributed: { adSetId: string; name: string; cities: string[]; spend: number; leads: number }[];
  unattributedSpend: number;
  leadAction: string;
  notes: string[];
  error?: string;
}

type SortKey = "cityName" | "spend" | "leads" | "cpl" | "inventory" | "ctr";

export default function CitiesPage() {
  const [range, setRange] = useState<DateRange>(() => resolvePreset("this_month"));
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showUnattributed, setShowUnattributed] = useState(false);

  const url = `/api/cities/live?${rangeToQuery(range)}`;
  const { data, loading, error } = useFetch<Payload>(url, []);

  const cities = data?.cities ?? [];

  const filtered = useMemo(() => {
    let rows = cities;
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((c) => c.cityName.toLowerCase().includes(q));
    return [...rows].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "cityName") return a.cityName.localeCompare(b.cityName) * dir;
      const av = (a[sortKey] as number | null) ?? -1;
      const bv = (b[sortKey] as number | null) ?? -1;
      return (av - bv) * dir;
    });
  }, [cities, search, sortKey, sortDir]);

  const totals = useMemo(() => {
    const spend = filtered.reduce((s, c) => s + c.spend, 0);
    const leads = filtered.reduce((s, c) => s + c.leads, 0);
    return { spend, leads, cpl: leads > 0 ? spend / leads : 0 };
  }, [filtered]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900 dark:text-ink-50 flex items-center gap-2">
            <MapPin className="h-5 w-5" /> City Performance
          </h1>
          <p className="text-sm mt-0.5">
            <RangeCaption range={range} />
          </p>
          {data && (
            <p className="text-xs text-ink-400 mt-0.5">
              {cities.length} {cities.length === 1 ? "city" : "cities"} targeted · compared with{" "}
              {data.previous.since} to {data.previous.until}
            </p>
          )}
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {(error || data?.error) && (
        <div className="rounded-2xl border border-negative/40 bg-negative/5 p-4">
          <p className="text-sm font-semibold text-negative">Could not read Meta</p>
          <p className="text-sm text-ink-700 dark:text-ink-200 mt-1">{error ?? data?.error}</p>
          <p className="text-xs text-ink-500 mt-2">
            The table below is empty because the request failed, not because nothing was delivered.
          </p>
        </div>
      )}

      {data && data.notes.length > 0 && (
        <div className="rounded-xl border border-caution/40 bg-caution/5 p-3 space-y-1">
          {data.notes.map((t, i) => (
            <p key={i} className="text-xs text-ink-700 dark:text-ink-200">
              {t}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
          <input
            className="input pl-8 w-56"
            placeholder="Search city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {data && (
          <span className="text-xs text-ink-500">
            {inr(totals.spend)} · {num(totals.leads)} lead{totals.leads === 1 ? "" : "s"}
            {totals.leads > 0 && <> · {inr(totals.cpl)} CPL</>}
          </span>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full table-clean min-w-[900px]">
          <thead>
            <tr>
              <Th label="City" k="cityName" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <th>Targeted as</th>
              <Th label="Inventory" k="inventory" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <Th label="Spend" k="spend" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <Th label="Leads" k="leads" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <Th label="CPL" k="cpl" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <th className="text-right">vs prev</th>
              <Th label="CTR" k="ctr" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <th className="text-right">CPC</th>
              <th className="text-right">Daily budget</th>
              <th className="text-right">Ad sets</th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              !data &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={11}>
                    <div className="h-6 bg-ink-50 dark:bg-ink-900 animate-pulse rounded" />
                  </td>
                </tr>
              ))}

            {filtered.map((c) => (
              <tr key={c.cityName}>
                <td>
                  <Link
                    href={`/campaigns?city=${encodeURIComponent(c.cityName)}`}
                    className="font-medium text-ink-800 dark:text-ink-100 hover:text-brand-600"
                  >
                    {c.cityName}
                  </Link>
                </td>
                {/* A region buy is broader than a city buy — Chandigarh is
                    targeted as a region, which is why its reach looks large
                    relative to the city. Worth showing, not hiding. */}
                <td className="text-ink-500 text-xs">{c.targetedAs.join(", ") || "—"}</td>
                <td className="text-right tabular-nums">
                  {c.inventory === null ? (
                    <span className="text-ink-400" title="No product set for this city in the Meta catalogue">
                      —
                    </span>
                  ) : (
                    <span className={cn(c.inventory === 0 && "text-negative font-medium")}>{num(c.inventory)}</span>
                  )}
                </td>
                <td className="text-right tabular-nums">{inr(c.spend, { compact: true })}</td>
                <td className="text-right tabular-nums">{num(c.leads)}</td>
                <td className="text-right tabular-nums">{c.leads > 0 ? inr(c.cpl) : <span className="text-ink-400">—</span>}</td>
                <td className="text-right">
                  {c.cplChangePct === null ? (
                    <span
                      className="text-xs text-ink-400"
                      title={
                        c.previousLeads === 0
                          ? "No leads in the previous window, so there is nothing to compare against"
                          : "No leads in this window"
                      }
                    >
                      —
                    </span>
                  ) : (
                    <DeltaChip value={c.cplChangePct} goodDirection="down" />
                  )}
                </td>
                <td className="text-right tabular-nums">{c.impressions > 0 ? `${c.ctr.toFixed(2)}%` : "—"}</td>
                <td className="text-right tabular-nums">{c.clicks > 0 ? inr(c.cpc) : "—"}</td>
                <td className="text-right tabular-nums">{c.dailyBudget > 0 ? inr(c.dailyBudget) : "—"}</td>
                <td className="text-right tabular-nums text-xs text-ink-500">
                  {c.activeAdSetCount} live<span className="text-ink-300"> / {c.adSetCount}</span>
                </td>
              </tr>
            ))}

            {data && filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={11} className="text-center text-sm text-ink-500 py-10">
                  {search
                    ? `No city matches "${search}".`
                    : "No ad set in this account targets a single named city, so there is nothing to group by."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Spend that genuinely cannot be attributed to one city. Shown rather
          than split evenly across the rows, which would invent delivery. */}
      {data && data.unattributed.length > 0 && (
        <div className="card p-4">
          <button
            className="text-sm text-ink-700 dark:text-ink-200 hover:text-brand-600 font-medium"
            onClick={() => setShowUnattributed((v) => !v)}
          >
            {data.unattributed.length} ad set{data.unattributed.length === 1 ? "" : "s"} not counted in any city row
            {data.unattributedSpend > 0 && <> · {inr(data.unattributedSpend)}</>}
            {showUnattributed ? " — hide" : " — show"}
          </button>
          {showUnattributed && (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs text-ink-500">
                Each of these targets more than one place, or no place at all. Meta reports their spend as one figure,
                so attributing it to a single city would be a guess.
              </p>
              {data.unattributed.map((u) => (
                <div key={u.adSetId} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-ink-700 dark:text-ink-200 truncate">{u.name}</span>
                  <span className="text-ink-500 shrink-0">
                    {u.cities.length > 0 ? u.cities.join(" + ") : "no city targeting"} · {inr(u.spend)} ·{" "}
                    {num(u.leads)} lead{u.leads === 1 ? "" : "s"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {data && (
        <p className="text-xs text-ink-400">
          Leads are counted from the pixel event <span className="font-mono">{data.leadAction}</span>. Qualified
          leads, CPQL, conversion rate and sales are not shown: those are CRM stages, and no lead system is connected
          to this app yet.
        </p>
      )}
    </div>
  );
}

function Th({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
  align,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onClick: (k: SortKey) => void;
  align?: "right";
}) {
  return (
    <th className={cn("cursor-pointer select-none", align === "right" && "text-right")} onClick={() => onClick(k)}>
      <span className={cn("inline-flex items-center gap-1", align === "right" && "flex-row-reverse")}>
        {label}
        <ArrowUpDown className={cn("h-3 w-3", sortKey === k ? "text-brand-600" : "text-ink-300")} />
      </span>
    </th>
  );
}
