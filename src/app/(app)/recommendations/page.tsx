"use client";

import { useSession } from "next-auth/react";
import { useFetch } from "@/lib/useFetch";
import { Check, X, Sparkles, Clock } from "lucide-react";

interface RecRow {
  id: string;
  scope: string;
  title: string;
  reasons: string[];
  recommendedAction: string;
  impactEstimate: string | null;
  cityName?: string;
  status: string;
  createdAt: string;
}

export default function RecommendationsPage() {
  const { data: session } = useSession();
  const canEdit = session?.user.role !== "VIEWER";

  const { data: reportData } = useFetch<{ summary: string }>("/api/reports?period=weekly");
  const { data, loading, refetch } = useFetch<{ recommendations: RecRow[] }>("/api/recommendations?source=AI&status=PENDING&limit=50");
  const { data: history } = useFetch<{ recommendations: RecRow[] }>("/api/recommendations?source=AI&status=ALL&limit=100");

  const resolved = (history?.recommendations ?? []).filter((r) => r.status !== "PENDING").slice(0, 8);

  async function resolve(id: string, status: "APPROVED" | "REJECTED") {
    await fetch(`/api/recommendations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    refetch();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Recommendations</h1>
        <p className="text-sm text-ink-500 mt-0.5">AI-generated insights — what happened, why, and what to do about it.</p>
      </div>

      {reportData?.summary && (
        <div className="card p-5 bg-gradient-to-br from-brand-950 to-ink-900 text-white border-none">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-brand-300" />
            <h2 className="font-semibold">AI Weekly Summary</h2>
          </div>
          <p className="text-sm leading-relaxed text-ink-100">{reportData.summary}</p>
        </div>
      )}

      <div className="space-y-3">
        {loading && Array.from({ length: 3 }).map((_, i) => <div key={i} className="card h-32 animate-pulse bg-ink-50" />)}
        {!loading && (data?.recommendations ?? []).length === 0 && (
          <div className="card p-8 text-center text-ink-400">No pending AI recommendations — everything is performing within target.</div>
        )}
        {(data?.recommendations ?? []).map((r) => (
          <div key={r.id} className="card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="font-medium text-ink-900">{r.title}</p>
                <ol className="mt-2 space-y-1">
                  {r.reasons.map((reason, i) => (
                    <li key={i} className="text-sm text-ink-500 flex gap-2">
                      <span className="text-ink-300 font-medium">{i + 1}.</span> {reason}
                    </li>
                  ))}
                </ol>
                <div className="mt-3 rounded-lg bg-brand-50 text-brand-800 px-3.5 py-2.5 text-sm">
                  <span className="font-medium">Recommended action: </span>
                  {r.recommendedAction}
                </div>
                {r.impactEstimate && <p className="text-xs text-ink-400 mt-2">{r.impactEstimate}</p>}
              </div>
              {canEdit && (
                <div className="flex flex-col gap-1.5 shrink-0">
                  <button onClick={() => resolve(r.id, "APPROVED")} className="btn-primary !py-1.5 !text-xs"><Check className="h-3.5 w-3.5" /> Approve</button>
                  <button onClick={() => resolve(r.id, "REJECTED")} className="btn-ghost !py-1.5 !text-xs"><X className="h-3.5 w-3.5" /> Reject</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {resolved.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-ink-400" />
            <h2 className="font-semibold text-ink-900">Recently Resolved</h2>
          </div>
          <div className="space-y-2">
            {resolved.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm py-1.5 border-b border-ink-50 last:border-0">
                <span className="text-ink-700">{r.title}</span>
                <span className={r.status === "APPROVED" ? "chip chip-positive" : "chip chip-neutral"}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
