"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import {
  ArrowRight,
  BarChart3,
  Eye,
  IndianRupee,
  MousePointerClick,
  Percent,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { useFetch } from "@/lib/useFetch";
import { StatCard } from "@/components/ui/StatCard";
import { DeltaChip } from "@/components/ui/DeltaChip";
import { BudgetTargetBand } from "@/components/BudgetTargetBand";
import { LiveRecommendations } from "@/components/LiveRecommendations";
import { DateRangePicker, RangeCaption } from "@/components/DateRangePicker";
import { DateRange, rangeToQuery, resolvePreset } from "@/lib/date-range";
import { inr, num } from "@/lib/format";

/**
 * The dashboard, on live Meta data, for whatever range is selected.
 *
 * What this page used to be is worth recording, because every change here is a
 * correction rather than a preference:
 *
 *   - The tiles read the local `performance_daily` table, which stopped being
 *     written on 2026-09-01, under a sidebar badge reading "Live — real ad
 *     account".
 *   - The window was hardcoded three times and disagreed with itself: "Last 7
 *     days" on the tiles, "Last 30 days" on the chart, and a 30-day query in
 *     the API behind the 7-day label.
 *   - Four of the eight tiles — Qualified Leads, CPQL, Sales, ROAS — are CRM
 *     stages that Meta does not report and this app has no lead source for.
 *     On seeded data they looked like measurements. They are gone until
 *     something real feeds them; a missing tile is honest, a fabricated one is
 *     not.
 *   - "Cities Needing Attention" was driven by a seeded status field. It now
 *     means something checkable: cost per lead is up against the preceding
 *     window of equal length.
 */

interface Totals {
  spend: number;
  leads: number;
  cpl: number;
  impressions: number;
  clicks: number;
  reach: number;
  ctr: number;
  cpc: number;
  cpm: number;
  frequency: number;
}

interface CityRow {
  cityName: string;
  targetedAs: string[];
  spend: number;
  leads: number;
  cpl: number;
  previousCpl: number;
  cplChangePct: number | null;
  activeAdSetCount: number;
  inventory: number | null;
}

interface Payload {
  range: { since: string; until: string };
  previous: { since: string; until: string };
  days: number;
  totals: Totals;
  previousTotals: Totals;
  series: { date: string; spend: number; leads: number }[];
  cities: CityRow[];
  unattributedSpend: number;
  leadAction: string;
  notes: string[];
  error?: string;
}

/** No baseline means no percentage — "+100%" against zero is invented. */
function pct(now: number, before: number): number | undefined {
  if (!before) return undefined;
  return ((now - before) / before) * 100;
}

export default function DashboardPage() {
  const [range, setRange] = useState<DateRange>(() => resolvePreset("this_month"));
  const url = `/api/dashboard/live?${rangeToQuery(range)}`;
  const { data, loading, error } = useFetch<Payload>(url, []);

  const cities = data?.cities ?? [];

  // Best cost per lead, among cities that actually delivered. A ₹0 CPL is the
  // absence of leads, not a good result, and ranking by it put empty cities at
  // the top of this table for weeks.
  const topCities = useMemo(
    () => cities.filter((c) => c.spend > 0 && c.leads > 0).sort((a, b) => a.cpl - b.cpl).slice(0, 4),
    [cities]
  );

  // Spending, and either paying more per lead than before or getting none.
  const attention = useMemo(
    () =>
      cities
        .filter((c) => c.spend > 0 && (c.leads === 0 || (c.cplChangePct !== null && c.cplChangePct > 10)))
        .sort((a, b) => (b.cplChangePct ?? 999) - (a.cplChangePct ?? 999))
        .slice(0, 4),
    [cities]
  );

  const t = data?.totals;
  const p = data?.previousTotals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900 dark:text-ink-50">Executive Dashboard</h1>
          <p className="text-sm mt-0.5">
            <RangeCaption range={range} />
          </p>
          {data && (
            <p className="text-xs text-ink-400 mt-0.5">
              Compared with {data.previous.since} to {data.previous.until} — the {data.days} day
              {data.days === 1 ? "" : "s"} immediately before.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker value={range} onChange={setRange} />
          <Link href="/ai-optimiser" className="btn-secondary">
            <Sparkles className="h-4 w-4 text-brand-600" /> Run AI Optimiser
          </Link>
        </div>
      </div>

      {/* Budget against target, month-to-date. Stays pinned to the calendar
          month whatever the range above says, because that is the window the
          budgets and lead targets are actually set in. */}
      <BudgetTargetBand />

      {(error || data?.error) && (
        <div className="rounded-2xl border border-negative/40 bg-negative/5 p-4">
          <p className="text-sm font-semibold text-negative">Could not read Meta</p>
          <p className="text-sm text-ink-700 dark:text-ink-200 mt-1">{error ?? data?.error}</p>
          <p className="text-xs text-ink-500 mt-2">
            Nothing below is zero because delivery was zero — the request itself failed. This page no longer falls
            back to the platform&apos;s own tables, because doing so put a fortnight-old picture under a live badge.
          </p>
        </div>
      )}

      {loading && !data && <SkeletonGrid />}

      {t && p && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Spend"
              value={inr(t.spend, { compact: true })}
              delta={pct(t.spend, p.spend)}
              goodDirection="down"
              icon={IndianRupee}
            />
            <StatCard
              label="Leads"
              value={num(t.leads)}
              delta={pct(t.leads, p.leads)}
              goodDirection="up"
              icon={Users}
              sub={data?.leadAction ? "pixel event" : undefined}
            />
            <StatCard
              label="Cost per lead"
              value={t.leads > 0 ? inr(t.cpl) : "—"}
              delta={t.leads > 0 && p.leads > 0 ? pct(t.cpl, p.cpl) : undefined}
              goodDirection="down"
              icon={Target}
              sub={t.leads === 0 ? "no leads in range" : undefined}
            />
            <StatCard
              label="Impressions"
              value={num(t.impressions)}
              delta={pct(t.impressions, p.impressions)}
              goodDirection="up"
              icon={Eye}
            />
            <StatCard
              label="Clicks"
              value={num(t.clicks)}
              delta={pct(t.clicks, p.clicks)}
              goodDirection="up"
              icon={MousePointerClick}
            />
            <StatCard label="CTR" value={`${t.ctr.toFixed(2)}%`} delta={pct(t.ctr, p.ctr)} goodDirection="up" icon={Percent} />
            <StatCard label="CPC" value={inr(t.cpc)} delta={pct(t.cpc, p.cpc)} goodDirection="down" icon={MousePointerClick} />
            <StatCard
              label="Reach"
              value={num(t.reach)}
              icon={BarChart3}
              sub={t.frequency > 0 ? `${t.frequency.toFixed(1)}× frequency` : undefined}
            />
          </div>

          {data && data.notes.length > 0 && (
            <div className="rounded-xl border border-caution/40 bg-caution/5 p-3 space-y-1">
              {data.notes.map((nText, i) => (
                <p key={i} className="text-xs text-ink-700 dark:text-ink-200">
                  {nText}
                </p>
              ))}
            </div>
          )}

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-ink-900 dark:text-ink-50">Spend &amp; leads</h2>
                  <p className="text-xs text-ink-500">
                    Daily, across the selected range. Gaps are days with no delivery.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-ink-500">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-brand-500" /> Spend
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-green-500" /> Leads
                  </span>
                </div>
              </div>
              {data && data.series.length === 0 ? (
                <p className="text-sm text-ink-500 py-16 text-center">
                  Meta reported no delivery on any day in this range.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={data?.series ?? []} margin={{ left: -20, right: 10 }}>
                    <defs>
                      <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1a73e8" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#1a73e8" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="leadsGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1e8e3e" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#1e8e3e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8eaed" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d: string) => d.slice(5)}
                      tick={{ fontSize: 11, fill: "#80868b" }}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={30}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 11, fill: "#80868b" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => (v >= 1000 ? `₹${Math.round(v / 1000)}K` : `₹${v}`)}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "#80868b" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: "1px solid #eceef2", fontSize: 12 }}
                      formatter={(value: number, name: string) =>
                        name === "spend" ? [inr(value), "Spend"] : [value, "Leads"]
                      }
                    />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="spend"
                      stroke="#1a73e8"
                      fill="url(#spendGrad)"
                      strokeWidth={2}
                    />
                    <Area
                      yAxisId="right"
                      type="monotone"
                      dataKey="leads"
                      stroke="#1e8e3e"
                      fill="url(#leadsGrad)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* The live recommendation panel, not the seeded one this card used
                to hold. It advises only on campaigns that are actually running
                and shows the windows it used. */}
            <LiveRecommendations />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="card p-5">
              <h2 className="font-semibold text-ink-900 dark:text-ink-50 mb-1">Best cost per lead</h2>
              <p className="text-xs text-ink-500 mb-3">Cities that delivered leads in this range.</p>
              <CityMiniTable rows={topCities} empty="No city produced a lead in this range." />
            </div>
            <div className="card p-5">
              <h2 className="font-semibold text-ink-900 dark:text-ink-50 mb-1">Needs attention</h2>
              <p className="text-xs text-ink-500 mb-3">
                Spending, and either paying more per lead than the previous {data?.days} days or producing none.
              </p>
              <CityMiniTable rows={attention} empty="No city is spending more per lead than before." />
            </div>
          </div>

          {data && data.unattributedSpend > 0 && (
            <p className="text-xs text-ink-500">
              City rows exclude {inr(data.unattributedSpend)} spent by ad sets that target more than one place. Meta
              does not report which city that went to, so splitting it would be a guess.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function CityMiniTable({ rows, empty }: { rows: CityRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-ink-400">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-clean">
        <thead>
          <tr>
            <th>City</th>
            <th className="text-right">Spend</th>
            <th className="text-right">Leads</th>
            <th className="text-right">CPL</th>
            <th className="text-right">vs prev</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.cityName}>
              <td>
                <Link
                  href={`/campaigns?city=${encodeURIComponent(c.cityName)}`}
                  className="font-medium text-ink-800 dark:text-ink-100 hover:text-brand-600"
                >
                  {c.cityName}
                </Link>
                {!c.targetedAs.includes("city") && c.targetedAs.length > 0 && (
                  <span className="ml-1.5 text-[10px] text-ink-400">{c.targetedAs.join("/")}</span>
                )}
              </td>
              <td className="text-right tabular-nums">{inr(c.spend, { compact: true })}</td>
              <td className="text-right tabular-nums">{num(c.leads)}</td>
              <td className="text-right tabular-nums">{c.leads > 0 ? inr(c.cpl) : "—"}</td>
              <td className="text-right">
                {c.cplChangePct === null ? (
                  <span className="text-xs text-ink-400" title="No leads in the previous window to compare against">
                    —
                  </span>
                ) : (
                  <DeltaChip value={c.cplChangePct} goodDirection="down" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="card p-4 h-24 animate-pulse bg-ink-50 dark:bg-ink-900" />
      ))}
    </div>
  );
}
