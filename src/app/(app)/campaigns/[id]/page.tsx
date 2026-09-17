"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useFetch } from "@/lib/useFetch";
import { inr, inrPrecise, num } from "@/lib/format";
import { StatusChip } from "@/components/ui/DeltaChip";
import { CityList } from "@/components/ui/CityList";
import { StatCard } from "@/components/ui/StatCard";
import { ArrowLeft, Pause, Play, Copy } from "lucide-react";

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const canEdit = session?.user.role !== "VIEWER";
  const { data, loading, refetch } = useFetch<any>(`/api/campaigns/${params.id}`);

  if (loading || !data) return <div className="h-64 animate-pulse bg-ink-50 rounded-xl" />;
  const { campaign, detail } = data;

  async function action(body: any) {
    await fetch(`/api/campaigns/${params.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    refetch();
  }

  async function duplicate() {
    const res = await fetch(`/api/campaigns/${params.id}/duplicate`, { method: "POST" });
    const json = await res.json();
    if (json.id) router.push(`/campaigns/${json.id}`);
  }

  return (
    <div className="space-y-6">
      <button onClick={() => router.push("/campaigns")} className="text-sm text-ink-500 hover:text-ink-800 flex items-center gap-1 w-fit">
        <ArrowLeft className="h-4 w-4" /> Back to campaigns
      </button>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-900 flex items-center gap-2 flex-wrap">
            {campaign.name}
            <StatusChip status={campaign.status} />
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            <CityList cities={campaign.cities} /> · {detail?.objective?.replace("_", " ")} · {detail?.audienceType} audience · {detail?.structureType?.replace(/_/g, " ")}
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2 shrink-0">
            {campaign.status === "ACTIVE" ? (
              <button className="btn-secondary" onClick={() => action({ action: "pause" })}><Pause className="h-4 w-4" /> Pause</button>
            ) : (
              <button className="btn-secondary" onClick={() => action({ action: "resume" })}><Play className="h-4 w-4" /> Resume</button>
            )}
            <button className="btn-secondary" onClick={duplicate}><Copy className="h-4 w-4" /> Duplicate</button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Daily Budget" value={inr(campaign.dailyBudget, { compact: true })} />
        <StatCard label="Spend (7d)" value={inr(campaign.spend, { compact: true })} />
        <StatCard label="Leads (7d)" value={num(campaign.leads)} />
        <StatCard label="CPL" value={campaign.leads > 0 ? inr(campaign.cpl) : "—"} sub={`Target ${inr(campaign.targetCpl)}`} />
        <StatCard label="CTR" value={`${campaign.ctr.toFixed(1)}%`} />
        <StatCard label="CPC" value={inrPrecise(campaign.cpc)} />
        <StatCard label="Frequency" value={campaign.frequency.toFixed(1)} />
        <StatCard label="Inventory" value={num(campaign.inventoryCount)} />
      </div>

      {canEdit && (
        <div className="card p-5 max-w-md">
          <h2 className="font-semibold text-ink-900 mb-3">Budget &amp; Target</h2>
          <BudgetEditor campaignId={campaign.campaignId} dailyBudget={campaign.dailyBudget} targetCpl={campaign.targetCpl} onSaved={refetch} />
        </div>
      )}
    </div>
  );
}

function BudgetEditor({ campaignId, dailyBudget, targetCpl, onSaved }: { campaignId: string; dailyBudget: number; targetCpl: number; onSaved: () => void }) {
  const [budget, setBudget] = useState(dailyBudget);
  const [cpl, setCpl] = useState(targetCpl);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await fetch(`/api/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailyBudget: budget, targetCpl: cpl }),
    });
    setSaving(false);
    onSaved();
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="label">Daily Budget (₹)</label>
        <input type="number" className="input" value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
      </div>
      <div>
        <label className="label">Target CPL (₹)</label>
        <input type="number" className="input" value={cpl} onChange={(e) => setCpl(Number(e.target.value))} />
      </div>
      <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
    </div>
  );
}
