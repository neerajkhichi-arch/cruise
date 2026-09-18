"use client";

import { useSession } from "next-auth/react";
import { useFetch } from "@/lib/useFetch";
import { Check, X, Sparkles, Clock, Info } from "lucide-react";
import { LiveRecommendations } from "@/components/LiveRecommendations";

/**
 * Recommendations.
 *
 * Two feeds used to be conflated here. The one this page showed was the STORED
 * feed, derived from the seeded `cities` / `campaigns` / `performance_daily`
 * tables — which have no ad account column. One set of rows, seeded from the
 * Used Cars Sales account, shown identically under every account in the
 * switcher. Switching to BikeDekho changed the name at the top of the screen
 * and nothing else, which is the most misleading thing a multi-account tool can
 * do: the advice looked account-specific and was not.
 *
 * So the live, per-account engine leads now. It reads delivery from Meta for
 * whichever account is selected, and it is the same component the Dashboard
 * uses. The stored feed still renders underneath on a mock install, where it is
 * the only thing there is; on a live install it withholds itself and says so.
 */

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

interface Feed {
  recommendations: RecRow[];
  unavailable?: boolean;
  reason?: string;
}

export default function RecommendationsPage() {
  const { data: session } = useSession();
  const canEdit = session?.user.role !== "VIEWER";

  const { data: reportData } = useFetch<{ summary?: string; unavailable?: boolean }>("/api/reports?period=weekly");
  const { data, loading, refetch } = useFetch<Feed>("/api/recommendations?source=AI&status=PENDING&limit=50");
  const { data: history } = useFetch<Feed>("/api/recommendations?source=AI&status=ALL&limit=100");

  const stored = data?.recommendations ?? [];
  const storedWithheld = data?.unavailable === true;
  const resolved = (history?.recommendations ?? []).filter((r) => r.status !== "PENDING").slice(0, 8);

  async function resolve(id: string, status: "APPROVED" | "REJECTED") {
    await fetch(`/api/recommendations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    refetch();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Recommendations</h1>
        <p className="text-sm text-ink-500 mt-0.5">
          Built from this account&apos;s delivery in Meta — switch accounts in the bar above to see another.
        </p>
      </div>

      {/* The per-account engine. Same component as the Dashboard, so the two
          screens cannot drift into disagreeing about the same account. */}
      <LiveRecommendations />

      {/* The AI weekly summary reads the seeded tables too, so it only appears
          when those are allowed. */}
      {reportData?.summary && !reportData.unavailable && (
        <div className="card p-5 bg-gradient-to-br from-brand-950 to-ink-900 text-white border-none">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-brand-300" />
            <h2 className="font-semibold">AI Weekly Summary</h2>
          </div>
          <p className="text-sm leading-relaxed text-ink-100">{reportData.summary}</p>
        </div>
      )}

      {storedWithheld && (
        <div className="card p-5 border-ink-200">
          <div className="flex gap-3">
            <Info className="h-4 w-4 text-ink-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-semibold text-ink-900 text-sm">The older recommendations feed is not shown here</h2>
              <p className="text-sm text-ink-500 mt-1 leading-relaxed">{data?.reason}</p>
            </div>
          </div>
        </div>
      )}

      {!storedWithheld && (
        <div className="space-y-3">
          {loading && Array.from({ length: 3 }).map((_, i) => <div key={i} className="card h-32 animate-pulse bg-ink-50" />)}
          {!loading && stored.length === 0 && (
            <div className="card p-8 text-center text-ink-400">
              No pending AI recommendations — everything is performing within target.
            </div>
          )}
          {stored.map((r) => (
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
                    <button onClick={() => resolve(r.id, "APPROVED")} className="btn-primary !py-1.5 !text-xs">
                      <Check className="h-3.5 w-3.5" /> Approve
                    </button>
                    <button onClick={() => resolve(r.id, "REJECTED")} className="btn-ghost !py-1.5 !text-xs">
                      <X className="h-3.5 w-3.5" /> Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-ink-400" />
            <h2 className="font-semibold text-ink-900">Recently Resolved</h2>
          </div>
          <div className="space-y-2">
            {resolved.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between text-sm py-1.5 border-b border-ink-50 last:border-0"
              >
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
