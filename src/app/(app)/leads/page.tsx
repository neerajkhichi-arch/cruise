"use client";

import { useFetch } from "@/lib/useFetch";
import { inr, num } from "@/lib/format";
import { StatCard } from "@/components/ui/StatCard";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

interface FunnelRow {
  cityId: string;
  cityName: string;
  impressions: number;
  clicks: number;
  leads: number;
  valid: number;
  qualified: number;
  sales: number;
  cpl: number;
  cpql: number;
}

const COLORS = ["#1a73e8", "#1e8e3e", "#e37400", "#9334e6", "#d93025", "#12b5cb", "#7cb342", "#e52592", "#f9ab00"];

export default function LeadsPage() {
  const { data, loading } = useFetch<{
    funnel: FunnelRow[];
    bySource: { source: string; count: number }[];
    unavailable?: boolean;
    reason?: string;
  }>("/api/leads");
  const funnel = data?.funnel ?? [];

  if (data?.unavailable) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-ink-900">Lead Quality</h1>
        <SeededDataNotice reason={data.reason ?? ""} />
      </div>
    );
  }

  const totals = funnel.reduce(
    (acc, f) => ({
      leads: acc.leads + f.leads,
      valid: acc.valid + f.valid,
      qualified: acc.qualified + f.qualified,
      sales: acc.sales + f.sales,
    }),
    { leads: 0, valid: 0, qualified: 0, sales: 0 }
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Lead Quality</h1>
        <p className="text-sm text-ink-500 mt-0.5">Impression → Click → Lead → Valid → Qualified → Sale, last 7 days.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Leads" value={num(totals.leads)} />
        <StatCard label="Valid Leads" value={num(totals.valid)} sub={totals.leads ? `${Math.round((totals.valid / totals.leads) * 100)}% of leads` : undefined} />
        <StatCard label="Qualified Leads" value={num(totals.qualified)} sub={totals.leads ? `${Math.round((totals.qualified / totals.leads) * 100)}% of leads` : undefined} />
        <StatCard label="Sales" value={num(totals.sales)} sub={totals.qualified ? `${Math.round((totals.sales / totals.qualified) * 100)}% of qualified` : undefined} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card overflow-x-auto">
          <table className="w-full table-clean">
            <thead>
              <tr>
                <th>City</th>
                <th className="text-right">Leads</th>
                <th className="text-right">Valid</th>
                <th className="text-right">Qualified</th>
                <th className="text-right">Sales</th>
                <th className="text-right">CPL</th>
                <th className="text-right">CPQL</th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={7}><div className="h-6 bg-ink-50 animate-pulse rounded" /></td></tr>)}
              {funnel.map((f) => (
                <tr key={f.cityId}>
                  <td className="font-medium text-ink-800">{f.cityName}</td>
                  <td className="text-right tabular-nums">{num(f.leads)}</td>
                  <td className="text-right tabular-nums">{num(f.valid)}</td>
                  <td className="text-right tabular-nums">{num(f.qualified)}</td>
                  <td className="text-right tabular-nums">{num(f.sales)}</td>
                  <td className="text-right tabular-nums">{f.leads > 0 ? inr(f.cpl) : "—"}</td>
                  <td className="text-right tabular-nums">{f.qualified > 0 ? inr(f.cpql) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-ink-900 mb-3">Leads by Source</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={data?.bySource ?? []} dataKey="count" nameKey="source" innerRadius={50} outerRadius={80} paddingAngle={2}>
                {(data?.bySource ?? []).map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

/**
 * Shown instead of the screen when the seeded tables are withheld.
 *
 * A blank screen would read as a bug and an empty state would read as "no
 * campaigns". Saying exactly why there is nothing, and which screens do have
 * real figures, is the only version that does not mislead.
 */
function SeededDataNotice({ reason }: { reason: string }) {
  return (
    <div className="card p-6 max-w-2xl">
      <h2 className="font-semibold text-ink-900">Not shown on a live install</h2>
      <p className="text-sm text-ink-600 mt-2 leading-relaxed">{reason}</p>
    </div>
  );
}
