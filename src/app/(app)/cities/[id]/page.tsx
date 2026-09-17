"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useFetch } from "@/lib/useFetch";
import { inr, num } from "@/lib/format";
import { DeltaChip, StatusChip } from "@/components/ui/DeltaChip";
import { StatCard } from "@/components/ui/StatCard";
import { ArrowLeft, Lightbulb, Layers } from "lucide-react";

export default function CityDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, loading } = useFetch<any>(`/api/cities/${params.id}`);

  if (loading || !data) return <div className="h-64 animate-pulse bg-ink-50 rounded-xl" />;
  const { city, campaigns, recommendations, structure, popularModels } = data;

  return (
    <div className="space-y-6">
      <Link href="/cities" className="text-sm text-ink-500 hover:text-ink-800 flex items-center gap-1 w-fit">
        <ArrowLeft className="h-4 w-4" /> Back to cities
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900 flex items-center gap-2">
            {city.cityName}
            <StatusChip status={city.status ?? "HEALTHY"} />
          </h1>
          <p className="text-sm text-ink-500 mt-0.5">{city.state} · Target CPL {inr(city.targetCpl)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Inventory" value={num(city.inventoryActive)} sub={`of ${num(city.inventoryTotal)} total`} />
        <StatCard label="Spend (7d)" value={inr(city.spend, { compact: true })} />
        <StatCard label="Leads (7d)" value={num(city.leads)} />
        <StatCard label="CPL" value={inr(city.cpl)} delta={city.wowCplChange} goodDirection="down" />
        <StatCard label="Qualified Leads" value={num(city.qualifiedLeads)} />
        <StatCard label="CPQL" value={inr(city.cpql)} />
        <StatCard label="Daily Budget" value={inr(city.dailyBudget, { compact: true })} />
        <StatCard label="New Inventory (7d)" value={num(city.inventoryNew7d)} sub={`${num(city.inventoryOld60d)} are 60+ days old`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-5">
          <h2 className="font-semibold text-ink-900 mb-3">Campaigns serving {city.cityName}</h2>
          <table className="w-full table-clean">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th className="text-right">Spend</th>
                <th className="text-right">Leads</th>
                <th className="text-right">CPL</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c: any) => (
                <tr key={c.campaignId}>
                  <td>
                    <Link href={`/campaigns/${c.campaignId}`} className="font-medium text-ink-800 hover:text-brand-600">
                      {c.name}
                    </Link>
                  </td>
                  <td><StatusChip status={c.status} /></td>
                  <td className="text-right tabular-nums">{inr(c.spend, { compact: true })}</td>
                  <td className="text-right tabular-nums">{num(c.leads)}</td>
                  <td className="text-right tabular-nums">{inr(c.cpl)}</td>
                </tr>
              ))}
              {campaigns.length === 0 && (
                <tr><td colSpan={5} className="text-center text-ink-400 py-6">No campaigns yet for this city.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2">
            <Layers className="h-4 w-4 text-brand-600" />
            <h2 className="font-semibold text-ink-900">Recommended Structure</h2>
          </div>
          <p className="text-sm font-medium text-ink-800">{structure.label}</p>
          <p className="text-xs text-ink-500 mt-1.5 leading-relaxed">{structure.explanation}</p>
          <div className="mt-4 pt-4 border-t border-ink-100">
            <p className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-2">Popular Models</p>
            <div className="space-y-1.5">
              {popularModels.map((m: any) => (
                <div key={m.label} className="flex items-center justify-between text-sm">
                  <span className="text-ink-700">{m.label}</span>
                  <span className="text-ink-400">{m.count} listed</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {recommendations.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            <h2 className="font-semibold text-ink-900">AI Recommendations for {city.cityName}</h2>
          </div>
          <div className="space-y-3">
            {recommendations.map((r: any, i: number) => (
              <div key={i} className="rounded-lg border border-ink-100 p-4">
                <p className="font-medium text-sm text-ink-800">{r.title}</p>
                <ul className="mt-2 space-y-1">
                  {r.reasons.map((reason: string, j: number) => (
                    <li key={j} className="text-xs text-ink-500 flex gap-1.5">
                      <span className="text-ink-300">{j + 1}.</span> {reason}
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-brand-700 bg-brand-50 rounded-md px-3 py-2 mt-3">{r.recommendedAction}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
