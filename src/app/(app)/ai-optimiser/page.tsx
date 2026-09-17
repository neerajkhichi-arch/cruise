"use client";

import { useState } from "react";
import { LiveRecommendations } from "@/components/LiveRecommendations";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useFetch } from "@/lib/useFetch";
import { inr, cn } from "@/lib/format";
import { Sliders, Check, X, AlertTriangle } from "lucide-react";

interface Rule {
  id: string;
  type: string;
  name: string;
  description: string;
  enabled: boolean;
  params: Record<string, number>;
}

interface Allocation {
  cityId: string;
  cityName: string;
  currentBudget: number;
  recommendedBudget: number;
  changePct: number;
  rationale: string;
}

interface RecRow {
  id: string;
  scope: string;
  source: string;
  title: string;
  recommendedAction: string;
  reasons: string[];
  status: string;
}

export default function AiOptimiserPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user.role === "ADMIN";
  const canEdit = session?.user.role !== "VIEWER";

  const { data: rulesData, refetch: refetchRules } = useFetch<{ rules: Rule[] }>("/api/rules");
  const { data: recData, refetch: refetchRecs } = useFetch<{ recommendations: RecRow[]; counts: any }>("/api/recommendations?source=RULE&status=PENDING&limit=100");

  const [applying, setApplying] = useState(false);

  const cityCampaignRecs = (recData?.recommendations ?? []).filter((r) => r.scope === "CITY" || r.scope === "CAMPAIGN");
  const vehicleFlagCount = recData?.counts?.vehicleFlags ?? 0;

  async function toggleRule(rule: Rule) {
    await fetch("/api/rules", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: rule.id, enabled: !rule.enabled }) });
    refetchRules();
  }


  async function resolve(id: string, status: "APPROVED" | "REJECTED") {
    await fetch(`/api/recommendations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    refetchRecs();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">AI Optimiser</h1>
        <p className="text-sm text-ink-500 mt-0.5">
          Rules that watch every live campaign, and budget recommendations built from the last three days
          against the last fortnight, inside each city&apos;s monthly budget.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sliders className="h-4 w-4 text-brand-600" />
            <h2 className="font-semibold text-ink-900">Optimisation Rules</h2>
          </div>
          <div className="space-y-3">
            {(rulesData?.rules ?? []).map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3 rounded-lg border border-ink-100 p-3">
                <div>
                  <p className="text-sm font-medium text-ink-800">{r.name}</p>
                  <p className="text-xs text-ink-500 mt-0.5">{r.description}</p>
                </div>
                <button
                  onClick={() => isAdmin && toggleRule(r)}
                  disabled={!isAdmin}
                  className={cn("shrink-0 h-5 w-9 rounded-full relative transition-colors", r.enabled ? "bg-brand-600" : "bg-ink-200", !isAdmin && "opacity-60 cursor-not-allowed")}
                  title={isAdmin ? "Toggle rule" : "Admin only"}
                >
                  <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform", r.enabled ? "translate-x-4" : "translate-x-0.5")} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <LiveRecommendations />
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-ink-900">Rule-Triggered Actions</h2>
          {vehicleFlagCount > 0 && (
            <Link href="/vehicles" className="text-xs text-ink-500 hover:text-brand-600 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> {vehicleFlagCount} vehicle-level flags — view in Vehicles
            </Link>
          )}
        </div>
        {cityCampaignRecs.length === 0 ? (
          <p className="text-sm text-ink-400 py-6 text-center">No campaign or city rule triggers right now — performance is within target.</p>
        ) : (
          <div className="space-y-3">
            {cityCampaignRecs.map((r) => (
              <div key={r.id} className="rounded-lg border border-ink-100 p-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-ink-800">{r.title}</p>
                  <p className="text-xs text-ink-500 mt-1">{r.recommendedAction}</p>
                </div>
                {canEdit && (
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => resolve(r.id, "APPROVED")} className="btn-secondary !py-1.5 !px-2.5 !text-xs"><Check className="h-3.5 w-3.5" /> Approve</button>
                    <button onClick={() => resolve(r.id, "REJECTED")} className="btn-ghost !py-1.5 !px-2.5 !text-xs"><X className="h-3.5 w-3.5" /> Reject</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
