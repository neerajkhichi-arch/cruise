"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, ChevronDown, RefreshCw, TrendingUp } from "lucide-react";
import { cn, inr } from "@/lib/format";

/**
 * Campaigns paying more per result for a reason nobody chose.
 *
 * The band deliberately shows the EXPLAINED ones too, behind a disclosure. A
 * list that silently drops "CPL up 40%, budget halved" invites the question
 * "did it miss that one?" every time — and the answer to that question is the
 * whole point of the feature. Naming them, in a quieter place, is what makes
 * the short list at the top credible.
 */

interface Window {
  since: string;
  until: string;
  spend: number;
  results: number;
  cpl: number;
  dailySpend: number;
}

interface Row {
  campaignId: string;
  name: string;
  status: string;
  cities: string[];
  resultType: string;
  resultAction?: string | null;
  baseline: Window;
  recent: Window;
  cplChange: number | null;
  spendChange: number | null;
  verdict: string;
  summary: string;
}

interface Payload {
  baselineWindow: { since: string; until: string };
  recentWindow: { since: string; until: string };
  attention: Row[];
  explained: Row[];
  counts: {
    attention: number;
    expectedAfterCut: number;
    scaling: number;
    steady: number;
    tooLittleHistory: number;
  };
  notes: string[];
}

const short = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(
    Date.UTC(y, m - 1, d)
  );
};

const signed = (v: number | null) =>
  v === null ? "—" : `${v >= 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)}%`;

export function CplAttention() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showExplained, setShowExplained] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns/attention", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not compare the two windows.");
        setData(null);
      } else setData(body as Payload);
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  }, []);

  // NOT loaded on mount, deliberately.
  //
  // This costs two paginated sweeps, of a 7-day and a 90-day window. Auto-
  // running it on every visit to the Campaigns screen added that to an account
  // already oscillating in and out of its own rate limit - the check meant to
  // find problems was making one. It runs when somebody asks for it, which is
  // also when the answer is wanted.
  const [started, setStarted] = useState(false);
  const run = useCallback(() => {
    setStarted(true);
    void load();
  }, [load]);

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-brand-600" />
          <h2 className="font-semibold text-ink-900 dark:text-ink-50">Needs attention</h2>
        </div>
        <button className="btn-secondary btn-sm !text-xs" onClick={run} disabled={busy}>
          <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
          {busy ? "Reading Meta..." : started ? "Refresh" : "Check"}
        </button>
      </div>

      {!started && !data && (
        <p className="text-xs text-ink-500 mt-1 max-w-2xl leading-relaxed">
          Compares the last week against each campaign&apos;s own previous three months, and raises only the ones
          paying more per result at unchanged spend &mdash; a rise a budget cut explains is not a finding. Two reads of
          Meta, so it runs when you ask rather than on every visit.
        </p>
      )}

      {data && (
        <p className="text-xs text-ink-500 mt-1">
          Last {short(data.recentWindow.since)}–{short(data.recentWindow.until)} against each campaign&apos;s own{" "}
          {short(data.baselineWindow.since)}–{short(data.baselineWindow.until)}. A rise that a budget cut explains is
          not listed here.
        </p>
      )}

      {error && <p className="text-sm text-caution mt-3">{error}</p>}
      {busy && !data && <div className="h-20 mt-3 rounded-lg bg-ink-100 dark:bg-ink-800 animate-pulse" />}

      {data && data.attention.length === 0 && (
        <p className="text-sm text-ink-500 mt-3">
          No campaign is paying materially more per result at unchanged spend. {data.counts.expectedAfterCut} rose after
          a budget cut and {data.counts.scaling} while scaling — both expected, listed below.
        </p>
      )}

      {data && data.attention.length > 0 && (
        <div className="mt-3 space-y-2">
          {data.attention.map((r) => (
            <div key={r.campaignId} className="rounded-lg border border-caution/40 bg-caution/5 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900 dark:text-ink-50 truncate">{r.name}</p>
                  <p className="text-xs text-ink-600 dark:text-ink-300 mt-1 leading-relaxed">{r.summary}</p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="block text-sm font-semibold text-negative tabular-nums">
                    {signed(r.cplChange)}
                  </span>
                  <span className="block text-[11px] text-ink-500">cost / result</span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-ink-500 tabular-nums">
                <span>
                  now {inr(r.recent.cpl)} · was {inr(r.baseline.cpl)}
                </span>
                <span>
                  {inr(r.recent.dailySpend, { compact: true })}/day · was{" "}
                  {inr(r.baseline.dailySpend, { compact: true })}/day ({signed(r.spendChange)})
                </span>
                <span>
                  {r.recent.results} result{r.recent.results === 1 ? "" : "s"} this week
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {data && data.explained.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowExplained((v) => !v)}
            className="btn-text !text-xs !px-0"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showExplained && "rotate-180")} />
            {showExplained ? "Hide" : "Show"} {data.explained.length} rise
            {data.explained.length === 1 ? "" : "s"} the budget already explains
          </button>
          {showExplained && (
            <div className="mt-2 space-y-1.5">
              {data.explained.map((r) => (
                <div
                  key={r.campaignId}
                  className="rounded-lg border border-ink-100 dark:border-ink-800 px-3 py-2 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-ink-800 dark:text-ink-100 truncate">{r.name}</p>
                    <p className="text-[11px] text-ink-500 mt-0.5 leading-relaxed">{r.summary}</p>
                  </div>
                  <span className="shrink-0 chip chip-neutral !text-[10px]">
                    {r.verdict === "SCALING" ? "scaling" : "budget cut"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {data && data.notes.length > 0 && (
        <div className="mt-3 flex gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-ink-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            {data.notes.map((n, i) => (
              <p key={i} className="text-[11px] text-ink-500 leading-relaxed">
                {n}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
