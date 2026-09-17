"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, EyeOff, RefreshCw, TrendingUp } from "lucide-react";
import { cn, inr } from "@/lib/format";

/**
 * Budget recommendations, with their working shown.
 *
 * Every recommendation states the windows it used, the numbers in each, and the
 * cohort those numbers belong to. That is not decoration — the panel this
 * replaces said "CPL ₹0 is below the ₹110 target, room to scale" about a city
 * with no delivery, and there was no way to tell from the screen that it was
 * nonsense. Showing the evidence is what makes a wrong recommendation visible
 * as wrong.
 *
 * The excluded list matters as much as the recommendations. "Why is Mohali not
 * here" should have an answer other than silence.
 */

interface WindowStats {
  since: string;
  until: string;
  spend: number;
  leads: number;
  cpl: number;
}

interface Rec {
  campaignId: string;
  campaignName: string;
  cityName: string;
  cohort: string;
  action: "DECREASE_BUDGET" | "INCREASE_BUDGET" | "PAUSE" | "INVESTIGATE";
  currentDailyBudget: number;
  suggestedDailyBudget: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  baseline: WindowStats;
  recent: WindowStats;
  month: {
    spend: number;
    budget: number | null;
    usedPct: number | null;
    projected: number | null;
    daysLeft: number;
  };
  reasons: string[];
}

interface Payload {
  baselineWindow: { since: string; until: string };
  recentWindow: { since: string; until: string };
  monthWindow: { since: string; until: string };
  recommendations: Rec[];
  excluded: { campaignName: string; cityName: string; reason: string }[];
}

const ACTION_LABEL: Record<Rec["action"], string> = {
  PAUSE: "Pause",
  DECREASE_BUDGET: "Reduce budget",
  INCREASE_BUDGET: "Increase budget",
  INVESTIGATE: "Look into this",
};

const short = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(
    Date.UTC(y, m - 1, d)
  );
};

export function LiveRecommendations() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/recommendations/live", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not build recommendations.");
        setData(null);
      } else {
        setData(body as Payload);
      }
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-brand-600" />
          <h2 className="font-semibold text-ink-900 dark:text-ink-50">Budget recommendations</h2>
        </div>
        <button className="btn-secondary btn-sm !text-xs" onClick={() => void load()} disabled={busy}>
          <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} /> Refresh
        </button>
      </div>

      {data && (
        <p className="text-xs text-ink-500 mb-3">
          Last {short(data.recentWindow.since)}–{short(data.recentWindow.until)} against{" "}
          {short(data.baselineWindow.since)}–{short(data.baselineWindow.until)}, with month-to-date spend from{" "}
          {short(data.monthWindow.since)}. Live campaigns only.
        </p>
      )}

      {error && <p className="text-sm text-caution py-4">{error}</p>}
      {!data && !error && <div className="h-24 rounded bg-ink-100 dark:bg-ink-800 animate-pulse" />}

      {data && data.recommendations.length === 0 && (
        <p className="text-sm text-ink-500 py-6 text-center">
          Nothing to change. Every live campaign is inside its budget and holding its cost per lead.
        </p>
      )}

      <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
        {data?.recommendations.map((r) => (
          <div
            key={r.campaignId}
            className={cn(
              "rounded-xl border p-3.5",
              r.action === "PAUSE"
                ? "border-negative/40 bg-negative/5"
                : r.action === "DECREASE_BUDGET"
                  ? "border-caution/40 bg-caution/5"
                  : "border-ink-200 dark:border-ink-800"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                  {r.cityName}
                  <span className="ml-2 text-xs font-normal text-ink-500">{ACTION_LABEL[r.action]}</span>
                </p>
                <p className="text-[11px] text-ink-500 truncate">{r.campaignName}</p>
              </div>
              <div className="text-right shrink-0">
                {r.suggestedDailyBudget !== null && r.action !== "INVESTIGATE" && (
                  <p className="text-xs font-medium">
                    <span className="text-ink-500">{inr(r.currentDailyBudget)}</span>
                    <ArrowRight className="inline h-3 w-3 mx-1 text-ink-400" />
                    <span
                      className={
                        r.action === "INCREASE_BUDGET"
                          ? "text-positive"
                          : r.action === "PAUSE"
                            ? "text-negative"
                            : "text-caution"
                      }
                    >
                      {r.action === "PAUSE" ? "stop" : inr(r.suggestedDailyBudget)}
                    </span>
                  </p>
                )}
                <p className="text-[10px] uppercase tracking-wide text-ink-400 mt-0.5">
                  {r.confidence.toLowerCase()} confidence
                </p>
              </div>
            </div>

            <ul className="mt-2 space-y-0.5">
              {r.reasons.map((why, i) => (
                <li key={i} className="text-xs text-ink-700 dark:text-ink-200">
                  {why}
                </li>
              ))}
            </ul>

            {/* The evidence, so a wrong recommendation is visible as wrong. */}
            <div className="mt-2 pt-2 border-t border-ink-200/60 dark:border-ink-800 grid grid-cols-3 gap-2 text-[11px]">
              <Evidence label={`Last 3d`} s={r.recent} />
              <Evidence label={`14d`} s={r.baseline} />
              <div>
                <p className="text-ink-400 uppercase tracking-wide">Month</p>
                <p className="text-ink-700 dark:text-ink-200 tabular-nums">
                  {inr(r.month.spend)}
                  {r.month.budget !== null && <> / {inr(r.month.budget)}</>}
                </p>
                <p className="text-ink-500">
                  {r.month.budget === null
                    ? "no budget"
                    : r.month.projected !== null
                      ? `${inr(r.month.projected)} projected`
                      : ""}
                </p>
              </div>
            </div>
            <p className="text-[10px] text-ink-400 mt-1.5 font-mono">{r.cohort}</p>
          </div>
        ))}
      </div>

      {data && data.excluded.length > 0 && (
        <div className="mt-3 pt-3 border-t border-ink-100 dark:border-ink-800">
          <button
            className="text-xs text-ink-500 hover:text-ink-900 dark:hover:text-ink-50 flex items-center gap-1.5"
            onClick={() => setShowExcluded((v) => !v)}
          >
            <EyeOff className="h-3.5 w-3.5" />
            {data.excluded.length} campaign{data.excluded.length === 1 ? "" : "s"} deliberately not advised on
            {showExcluded ? " — hide" : " — show why"}
          </button>
          {showExcluded && (
            <div className="mt-2 space-y-1">
              {data.excluded.map((e, i) => (
                <p key={i} className="text-[11px] text-ink-500">
                  <span className="text-ink-700 dark:text-ink-200">{e.campaignName}</span> — {e.reason}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Evidence({ label, s }: { label: string; s: WindowStats }) {
  return (
    <div>
      <p className="text-ink-400 uppercase tracking-wide">{label}</p>
      <p className="text-ink-700 dark:text-ink-200 tabular-nums">
        {s.leads} lead{s.leads === 1 ? "" : "s"} · {inr(s.spend)}
      </p>
      <p className="text-ink-500 tabular-nums">{s.cpl > 0 ? `${inr(Math.round(s.cpl))} CPL` : "—"}</p>
    </div>
  );
}
