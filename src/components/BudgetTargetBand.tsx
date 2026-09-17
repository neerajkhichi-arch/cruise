"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, PauseCircle, Wallet } from "lucide-react";
import { cn, inr } from "@/lib/format";

/**
 * Month-to-date budget and target status, per city, on the dashboard.
 *
 * It reads the same live endpoint the Lead targets screen does rather than the
 * local tables the rest of this dashboard uses. That is deliberate: those
 * tables stopped being written on 2026-09-01, which is why every tile above
 * reads ₹0. Two numbers on one screen that disagree is worse than one number,
 * so this band says where its figures come from.
 *
 * The summary answers the question a P&L owner actually has — how much of the
 * month's money is gone, and which cities are past their limit — before any of
 * the per-city detail.
 */

interface Row {
  cityName: string;
  target: number | null;
  leads: number;
  spend: number;
  budget: number | null;
  progress: number | null;
  budgetProgress: number | null;
  status: "OVER" | "CLOSE" | "UNDER" | "NO_TARGET" | "NO_DELIVERY";
  budgetStatus: "EXHAUSTED" | "CLOSE" | "WITHIN" | "NO_BUDGET";
  stopReason: "BUDGET" | "TARGET" | null;
  projectedExhaustDate: string | null;
  campaigns: { campaignId: string; campaignName: string; status: string }[];
}

interface Payload {
  period: { since: string; until: string };
  rows: Row[];
  sheet: { problems: string[] };
}

function pct(v: number | null): number | null {
  return v === null ? null : Math.round(v * 100);
}

export function BudgetTargetBand() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/lead-targets", { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json();
        if (cancelled) return;
        if (!r.ok) setError(body.error ?? "Could not read budgets.");
        else setData(body as Payload);
      })
      .catch(() => {
        if (!cancelled) setError("Could not reach the server.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="card p-5">
        <p className="font-semibold text-ink-900 dark:text-ink-50 flex items-center gap-2">
          <Wallet className="h-4 w-4" /> Budgets and targets
        </p>
        <p className="text-sm text-caution mt-1.5">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card p-5">
        <div className="h-4 w-40 rounded bg-ink-100 dark:bg-ink-800 animate-pulse" />
        <div className="h-20 mt-4 rounded bg-ink-100 dark:bg-ink-800 animate-pulse" />
      </div>
    );
  }

  // Only cities the sheet actually governs count toward the money totals. A
  // city with no budget has no share of a budget to be "within".
  const governed = data.rows.filter((r) => r.budget !== null);
  const totalBudget = governed.reduce((s, r) => s + (r.budget ?? 0), 0);
  const totalSpend = governed.reduce((s, r) => s + r.spend, 0);
  const usedPct = totalBudget > 0 ? Math.round((totalSpend / totalBudget) * 100) : null;

  const overBudget = data.rows.filter((r) => r.budgetStatus === "EXHAUSTED");
  const overTarget = data.rows.filter((r) => r.status === "OVER");
  const stillSpending = [...overBudget, ...overTarget].filter((r) =>
    r.campaigns.some((c) => c.status === "ACTIVE")
  );
  // Spend beyond the ceiling, counted only on cities that actually passed it —
  // netting it against cities still under would hide the overspend entirely.
  const overspend = overBudget.reduce((s, r) => s + (r.spend - (r.budget ?? 0)), 0);
  // Cities delivering with no ceiling at all. This is how spend escapes a
  // budget regime without anybody deciding that it should.
  const ungoverned = data.rows.filter((r) => r.budget === null && r.spend > 0);

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-semibold text-ink-900 dark:text-ink-50 flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Budgets and targets
          </h2>
          <p className="text-xs text-ink-500 mt-0.5">
            {data.period.since} to {data.period.until} · live from Meta, against the targets sheet
          </p>
        </div>
        <Link href="/lead-targets" className="btn-secondary btn-sm !text-xs">
          Open <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* --- the summary, before any per-city detail --------------------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile label="Budget this month" value={totalBudget > 0 ? inr(totalBudget) : "—"} sub={`${governed.length} cities`} />
        <Tile
          label="Spent"
          value={inr(totalSpend)}
          sub={usedPct === null ? "no budgets set" : `${usedPct}% of budget`}
          tone={usedPct !== null && usedPct >= 100 ? "bad" : usedPct !== null && usedPct >= 85 ? "warn" : "plain"}
        />
        <Tile
          label="Over budget"
          value={String(overBudget.length)}
          sub={overspend > 0 ? `${inr(Math.round(overspend))} past the cap` : "none"}
          tone={overBudget.length > 0 ? "bad" : "plain"}
        />
        <Tile
          label="Target reached"
          value={String(overTarget.length)}
          sub={overTarget.length > 0 ? "goal met" : "none yet"}
          tone={overTarget.length > 0 ? "good" : "plain"}
        />
      </div>

      {/* The one line that should make somebody act. */}
      {stillSpending.length > 0 && (
        <div className="rounded-xl border border-negative/40 bg-negative/5 p-3 mb-4">
          <p className="text-sm font-semibold text-negative flex items-center gap-1.5">
            <PauseCircle className="h-4 w-4" />
            {stillSpending.length} {stillSpending.length === 1 ? "city is" : "cities are"} past a limit and still
            spending
          </p>
          <p className="text-xs text-ink-700 dark:text-ink-200 mt-1">
            {stillSpending.map((r) => r.cityName).join(", ")} —{" "}
            <Link href="/lead-targets" className="underline">
              stop them on Lead targets
            </Link>
            .
          </p>
        </div>
      )}

      {ungoverned.length > 0 && (
        <div className="rounded-xl border border-caution/40 bg-caution/5 p-3 mb-4">
          <p className="text-xs text-caution flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Spending with no budget in the sheet: {ungoverned.map((r) => `${r.cityName} (${inr(r.spend)})`).join(", ")}
          </p>
        </div>
      )}

      {/* --- per city ----------------------------------------------------- */}
      <div className="space-y-2.5">
        {data.rows.slice(0, 8).map((r) => {
          const bp = pct(r.budgetProgress);
          const tp = pct(r.progress);
          return (
            <div key={r.cityName} className="flex items-center gap-3">
              <div className="w-28 shrink-0">
                <p className="text-sm font-medium text-ink-900 dark:text-ink-50 truncate">{r.cityName}</p>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-ink-400 w-12 shrink-0">Budget</span>
                  <div className="flex-1 h-1.5 rounded-full bg-ink-100 dark:bg-ink-800 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        r.budgetStatus === "EXHAUSTED"
                          ? "bg-negative"
                          : r.budgetStatus === "CLOSE"
                            ? "bg-caution"
                            : "bg-brand-600"
                      )}
                      style={{ width: `${Math.min(100, bp ?? 0)}%` }}
                    />
                  </div>
                  <span className="text-[11px] tabular-nums text-ink-500 w-24 text-right shrink-0">
                    {r.budget === null ? "no budget" : `${inr(r.spend)} / ${inr(r.budget)}`}
                  </span>
                </div>

                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] uppercase tracking-wide text-ink-400 w-12 shrink-0">Leads</span>
                  <div className="flex-1 h-1.5 rounded-full bg-ink-100 dark:bg-ink-800 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        r.status === "OVER" ? "bg-positive" : r.status === "CLOSE" ? "bg-caution" : "bg-ink-300"
                      )}
                      style={{ width: `${Math.min(100, tp ?? 0)}%` }}
                    />
                  </div>
                  <span className="text-[11px] tabular-nums text-ink-500 w-24 text-right shrink-0">
                    {r.target === null ? `${r.leads} · no target` : `${r.leads} / ${r.target}`}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {data.sheet.problems.length > 0 && (
        <p className="text-[11px] text-caution mt-3">
          {data.sheet.problems.length} row{data.sheet.problems.length === 1 ? "" : "s"} in the sheet could not be
          read — see Lead targets.
        </p>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone = "plain",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "plain" | "good" | "warn" | "bad";
}) {
  return (
    <div className="rounded-xl border border-ink-200 dark:border-ink-800 p-3">
      <p className="text-[11px] uppercase tracking-wide text-ink-500">{label}</p>
      <p
        className={cn(
          "text-lg font-semibold mt-0.5",
          tone === "bad"
            ? "text-negative"
            : tone === "warn"
              ? "text-caution"
              : tone === "good"
                ? "text-positive"
                : "text-ink-900 dark:text-ink-50"
        )}
      >
        {value}
      </p>
      {sub && <p className="text-[11px] text-ink-500 mt-0.5">{sub}</p>}
    </div>
  );
}

