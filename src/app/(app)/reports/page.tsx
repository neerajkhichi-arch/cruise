"use client";

import { useState } from "react";
import { useFetch } from "@/lib/useFetch";
import { inr, num, formatDate } from "@/lib/format";
import { Download, FileSpreadsheet, Sparkles } from "lucide-react";

interface ReportData {
  period: string;
  range: { start: string; end: string };
  totals: { spend: number; leads: number; qualified: number; cpl: number; cpql: number };
  summary: string;
  cities: { name: string; spend: number; leads: number; cpl: number; qualifiedLeads: number; cpql: number; wowCplChange: number }[];
  campaigns: { name: string; status: string; spend: number; leads: number; cpl: number; ctr: number }[];
  inventory: { total: number; active: number; sold: number; noLead: number };
  aiRecommendations: { title: string; action: string }[];
  actionsTaken: { title: string; action: string; resolvedAt?: string }[];
}

const PERIODS = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

export default function ReportsPage() {
  const [period, setPeriod] = useState("weekly");
  const { data, loading } = useFetch<ReportData & { unavailable?: boolean; reason?: string }>(
    `/api/reports?period=${period}`,
    [period]
  );

  if (data?.unavailable) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-ink-900">Reports</h1>
        <SeededDataNotice reason={data.reason ?? ""} />
      </div>
    );
  }

  function exportExcel() {
    if (!data) return;
    const lines: string[] = [];
    lines.push(`Cruise — ${period} report`);
    lines.push(`Range,${formatDate(data.range.start)} - ${formatDate(data.range.end)}`);
    lines.push("");
    lines.push("City,Spend,Leads,CPL,Qualified Leads,CPQL,WoW CPL %");
    for (const c of data.cities) {
      lines.push(`${c.name},${Math.round(c.spend)},${c.leads},${Math.round(c.cpl)},${c.qualifiedLeads},${Math.round(c.cpql)},${c.wowCplChange.toFixed(1)}`);
    }
    lines.push("");
    lines.push("Campaign,Status,Spend,Leads,CPL,CTR %");
    for (const c of data.campaigns) {
      lines.push(`"${c.name}",${c.status},${Math.round(c.spend)},${c.leads},${Math.round(c.cpl)},${c.ctr.toFixed(1)}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `autocampaign-${period}-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Reports</h1>
          <p className="text-sm text-ink-500 mt-0.5">Performance, inventory, and AI actions for the selected period.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-ink-200 overflow-hidden">
            {PERIODS.map((p) => (
              <button key={p.id} onClick={() => setPeriod(p.id)} className={`px-3.5 py-2 text-sm font-medium ${period === p.id ? "bg-brand-600 text-white" : "bg-white text-ink-600 hover:bg-ink-50"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <button className="btn-secondary" onClick={() => window.print()}><Download className="h-4 w-4" /> Download PDF</button>
          <button className="btn-secondary" onClick={exportExcel}><FileSpreadsheet className="h-4 w-4" /> Export Excel</button>
        </div>
      </div>

      {loading || !data ? (
        <div className="h-96 animate-pulse bg-ink-50 rounded-xl" />
      ) : (
        <div className="space-y-6 print:text-black">
          <div className="card p-5">
            <p className="text-xs text-ink-400 uppercase tracking-wide">{period} report</p>
            <p className="text-sm text-ink-500">{formatDate(data.range.start)} — {formatDate(data.range.end)}</p>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mt-4">
              <Metric label="Spend" value={inr(data.totals.spend, { compact: true })} />
              <Metric label="Leads" value={num(data.totals.leads)} />
              <Metric label="CPL" value={inr(data.totals.cpl)} />
              <Metric label="Qualified Leads" value={num(data.totals.qualified)} />
              <Metric label="CPQL" value={inr(data.totals.cpql)} />
            </div>
          </div>

          <div className="card p-5 bg-ink-900 text-white border-none">
            <div className="flex items-center gap-2 mb-2"><Sparkles className="h-4 w-4 text-brand-300" /><h2 className="font-semibold">AI Summary</h2></div>
            <p className="text-sm leading-relaxed text-ink-100">{data.summary}</p>
          </div>

          <div className="card p-5 overflow-x-auto">
            <h2 className="font-semibold text-ink-900 mb-3">City Performance</h2>
            <table className="w-full table-clean">
              <thead><tr><th>City</th><th className="text-right">Spend</th><th className="text-right">Leads</th><th className="text-right">CPL</th><th className="text-right">Qualified</th><th className="text-right">CPQL</th></tr></thead>
              <tbody>
                {data.cities.map((c) => (
                  <tr key={c.name}>
                    <td className="font-medium text-ink-800">{c.name}</td>
                    <td className="text-right tabular-nums">{inr(c.spend, { compact: true })}</td>
                    <td className="text-right tabular-nums">{num(c.leads)}</td>
                    <td className="text-right tabular-nums">{c.leads ? inr(c.cpl) : "—"}</td>
                    <td className="text-right tabular-nums">{num(c.qualifiedLeads)}</td>
                    <td className="text-right tabular-nums">{c.qualifiedLeads ? inr(c.cpql) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="card p-5">
              <h2 className="font-semibold text-ink-900 mb-2">Inventory Snapshot</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Metric label="Total" value={num(data.inventory.total)} />
                <Metric label="Active" value={num(data.inventory.active)} />
                <Metric label="Sold" value={num(data.inventory.sold)} />
                <Metric label="No-Lead Flags" value={num(data.inventory.noLead)} />
              </div>
            </div>
            <div className="card p-5">
              <h2 className="font-semibold text-ink-900 mb-2">Actions Taken</h2>
              {data.actionsTaken.length === 0 ? (
                <p className="text-sm text-ink-400">No approved actions in this period yet.</p>
              ) : (
                <ul className="space-y-2">
                  {data.actionsTaken.map((a, i) => (
                    <li key={i} className="text-sm text-ink-700">✓ {a.action}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="font-semibold text-ink-900 mb-2">Open AI Recommendations</h2>
            {data.aiRecommendations.length === 0 ? (
              <p className="text-sm text-ink-400">Nothing outstanding.</p>
            ) : (
              <ul className="space-y-2">
                {data.aiRecommendations.map((r, i) => (
                  <li key={i} className="text-sm"><span className="font-medium text-ink-800">{r.title}</span> — <span className="text-ink-500">{r.action}</span></li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-400">{label}</p>
      <p className="text-lg font-semibold text-ink-900 tabular-nums">{value}</p>
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
