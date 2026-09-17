"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, History, PauseCircle, Play, RefreshCw, ShieldCheck, Target } from "lucide-react";
import { cn } from "@/lib/format";
import { DateRangePicker, RangeCaption } from "@/components/DateRangePicker";
import { type DateRange, resolvePreset } from "@/lib/date-range";

/**
 * City lead targets against Meta's month-to-date numbers.
 *
 * The screen exists to answer one question — which cities have had enough
 * leads this month — and to make acting on it one click. It does not pause
 * anything on its own: the count is Meta's attribution, not the CRM, and the
 * consequence of a wrong count is a market switched off with nobody told.
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
  attributionSettings: string[];
}

interface Payload {
  period: { since: string; until: string };
  rows: Row[];
  sheet: { fetchedAt: string; problems: string[]; cityCount: number };
  actionType: string;
  notes: string[];
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const STATUS_LABEL: Record<Row["status"], string> = {
  OVER: "Target reached",
  CLOSE: "Close to target",
  UNDER: "Running",
  NO_TARGET: "No target in the sheet",
  NO_DELIVERY: "No delivery this month",
};

/** "19 Sept" — enough to act on, short enough for a table cell. */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(
    Date.UTC(y, m - 1, d)
  );
}

function Bar({ pct, tone }: { pct: number; tone: "over" | "close" | "under" }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-ink-100 dark:bg-ink-800 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full",
            tone === "over" ? "bg-negative" : tone === "close" ? "bg-caution" : "bg-brand-600"
          )}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-ink-600 dark:text-ink-300 w-10 text-right">{pct}%</span>
    </div>
  );
}

export default function LeadTargetsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<{ message: string; needsSheet?: boolean; needsLive?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pausing, setPausing] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  // Targets are monthly, so month-to-date is the default — but any range can be
  // asked for, which is how a number gets checked against Ads Manager.
  const [range, setRange] = useState<DateRange>(() => resolvePreset("this_month"));
  // What the automation has actually done. An automatic pause you can only
  // discover in Ads Manager is worse than no automation at all.
  const [enforce, setEnforce] = useState<{
    enabled: boolean;
    log: {
      at: string;
      cityName: string;
      reason: "BUDGET" | "TARGET";
      leads: number;
      target: number | null;
      spend: number;
      budget: number | null;
      paused: string[];
      failed: { campaignId: string; error: string }[];
      trigger: "auto" | "manual";
    }[];
  } | null>(null);

  // Running the check by hand, and SEEING WHAT IT DECIDED. Without this the
  // only way to find out why a city was not paused was to wait 30 minutes and
  // read a terminal — which is not a diagnosis, it is a guess with a delay.
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{
    ran: boolean;
    skipped: string | null;
    paused: { cityName: string; reason: string }[];
    refused: { cityName: string; reason: string }[];
  } | null>(null);

  const runCheck = useCallback(async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await fetch("/api/lead-targets/enforce", { method: "POST" });
      const body = await res.json();
      setCheckResult(res.ok ? body : { ran: false, skipped: body.error ?? "Check failed.", paused: [], refused: [] });
    } catch {
      setCheckResult({ ran: false, skipped: "Could not reach the server.", paused: [], refused: [] });
    }
    setChecking(false);
  }, []);

  const loadEnforce = useCallback(async () => {
    try {
      const res = await fetch("/api/lead-targets/enforce", { cache: "no-store" });
      if (res.ok) setEnforce(await res.json());
    } catch {
      /* the log is context, not the page's purpose */
    }
  }, []);
  useEffect(() => {
    void loadEnforce();
  }, [loadEnforce]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ since: range.since, until: range.until }).toString();
      const res = await fetch(`/api/lead-targets?${qs}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setError({ message: body.error ?? "Could not read targets.", needsSheet: body.needsSheet, needsLive: body.needsLive });
        setData(null);
      } else {
        setData(body as Payload);
      }
    } catch {
      setError({ message: "Could not reach the server." });
    }
    setBusy(false);
  }, [range.since, range.until]);

  useEffect(() => {
    void load();
  }, [load]);

  async function pause(row: Row) {
    const live = row.campaigns.filter((c) => c.status === "ACTIVE");
    if (live.length === 0) return;
    setPausing(row.cityName);
    setOutcome(null);
    try {
      const res = await fetch("/api/lead-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cityName: row.cityName, campaignIds: live.map((c) => c.campaignId) }),
      });
      const body = await res.json();
      if (!res.ok) {
        setOutcome(body.error ?? "Pause failed.");
      } else if (body.ok) {
        setOutcome(
          `${row.cityName}: paused ${body.paused.length} campaign${body.paused.length === 1 ? "" : "s"} in Meta — ` +
            (row.stopReason === "BUDGET"
              ? `budget exhausted at ₹${row.spend.toLocaleString("en-IN")} of ₹${(row.budget ?? 0).toLocaleString("en-IN")}.`
              : `target reached at ${row.leads} of ${row.target} leads.`)
        );
        await load();
        await loadEnforce();
      } else {
        setOutcome(
          `${row.cityName}: paused ${body.paused.length}, failed ${body.failed.length} — ${body.failed
            .map((f: { error: string }) => f.error)
            .join("; ")}`
        );
        await load();
      }
    } catch {
      setOutcome("Could not reach the server.");
    }
    setPausing(null);
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-ink-900 dark:text-ink-50 flex items-center gap-2">
            <Target className="h-5 w-5" /> Lead targets
          </h1>
          <p className="text-sm text-ink-600 dark:text-ink-300 mt-1">
            Targets from the sheet, against what Meta reported over{" "}
            <RangeCaption range={range} />.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker value={range} onChange={setRange} />
          <button
            className="btn-secondary"
            onClick={async () => {
              await runCheck();
              await load();
              await loadEnforce();
            }}
            disabled={checking}
            title="Run the budget and target check now, and show what it decided"
          >
            <Play className={cn("h-4 w-4", checking && "animate-pulse")} />
            {checking ? "Checking…" : "Run check now"}
          </button>
          <button className="btn-secondary" onClick={() => void load()} disabled={busy}>
            <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} /> Refresh
          </button>
        </div>
      </div>

      {outcome && (
        <div className="card mb-4 !p-4">
          <p className="text-sm text-ink-900 dark:text-ink-50">{outcome}</p>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-negative/40 bg-negative/5 p-5 mb-4">
          <p className="text-sm font-semibold text-negative mb-1">Nothing to compare yet</p>
          <p className="text-sm text-ink-700 dark:text-ink-200">{error.message}</p>
          {error.needsSheet && (
            <div className="mt-3 text-xs text-ink-600 dark:text-ink-300 space-y-1">
              <p className="font-semibold text-ink-800 dark:text-ink-100">To connect the sheet:</p>
              <p>1. In Google Sheets: File → Share → Publish to web → choose the tab → CSV → Publish.</p>
              <p>2. Copy that URL into your .env as LEAD_TARGETS_CSV_URL, then restart the server.</p>
              <p>
                3. The tab needs two columns: <span className="font-mono">City</span> and{" "}
                <span className="font-mono">Target</span>. Anything else on it is ignored.
              </p>
              <p className="text-caution">
                A published tab is readable by anyone with the link, so keep it to city names and numbers.
              </p>
            </div>
          )}
        </div>
      )}

      {data && data.sheet.problems.length > 0 && (
        <div className="rounded-2xl border border-caution/40 bg-caution/5 p-4 mb-4">
          <p className="text-sm font-semibold text-caution mb-1.5">
            {data.sheet.problems.length} row{data.sheet.problems.length === 1 ? "" : "s"} in the sheet could not be read
          </p>
          {data.sheet.problems.map((p, i) => (
            <p key={i} className="text-xs text-ink-700 dark:text-ink-200">
              {p}
            </p>
          ))}
        </div>
      )}

      {checkResult && (
        <div className="rounded-2xl border border-ink-200 dark:border-ink-800 p-4 mb-4">
          <p className="text-sm font-semibold text-ink-900 dark:text-ink-50 mb-1.5">Check result</p>
          {checkResult.skipped ? (
            <p className="text-sm text-caution">Nothing was paused — {checkResult.skipped}</p>
          ) : checkResult.paused.length === 0 && checkResult.refused.length === 0 ? (
            <p className="text-sm text-ink-600 dark:text-ink-300">
              Ran, and no city was over its budget or its target. If you expected one to be, check that its
              Budget column in the sheet has a number and that the city name matches the one shown below.
            </p>
          ) : (
            <div className="space-y-1">
              {checkResult.paused.map((p, i) => (
                <p key={`p${i}`} className="text-sm text-ink-900 dark:text-ink-50">
                  Paused {p.cityName} — {p.reason === "BUDGET" ? "budget exhausted" : "target reached"}
                </p>
              ))}
              {checkResult.refused.map((r, i) => (
                <p key={`r${i}`} className="text-sm text-caution">
                  Left {r.cityName} running — {r.reason}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {enforce && (
        <div
          className={cn(
            "rounded-2xl border p-4 mb-4",
            enforce.enabled
              ? "border-caution/40 bg-caution/5"
              : "border-ink-200 dark:border-ink-800"
          )}
        >
          <p className="text-sm font-semibold flex items-center gap-1.5 text-ink-900 dark:text-ink-50">
            <ShieldCheck className="h-4 w-4" />
            {enforce.enabled ? "Auto-pause is armed" : "Auto-pause is off"}
          </p>
          <p className="text-xs text-ink-600 dark:text-ink-300 mt-1">
            {enforce.enabled
              ? "Cities over budget or over target are paused in Meta without asking — but only while the server is running. Nothing is checked when it is stopped."
              : "Set AUTO_PAUSE=true and AUTO_PAUSE_SECRET in .env, then restart, to let the app pause cities on its own."}
          </p>
        </div>
      )}

      {enforce && enforce.log.length > 0 && (
        <div className="rounded-2xl border border-ink-200 dark:border-ink-800 p-4 mb-4">
          <p className="text-xs font-semibold text-ink-700 dark:text-ink-200 mb-2 flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" /> What has been paused
          </p>
          <div className="space-y-1">
            {enforce.log.slice(0, 8).map((e, i) => (
              <p key={i} className="text-xs text-ink-600 dark:text-ink-300">
                <span className="text-ink-500">{new Date(e.at).toLocaleString("en-IN")}</span> ·{" "}
                <span className="font-semibold text-ink-900 dark:text-ink-50">{e.cityName}</span> ·{" "}
                {e.reason === "BUDGET"
                  ? `budget ${inr(e.spend)} of ${inr(e.budget ?? 0)}`
                  : `${e.leads} of ${e.target} leads`}{" "}
                · {e.paused.length} paused
                {e.failed.length > 0 && <span className="text-negative"> · {e.failed.length} failed</span>} ·{" "}
                <span className={e.trigger === "auto" ? "text-caution" : "text-ink-500"}>
                  {e.trigger === "auto" ? "automatic" : "by you"}
                </span>
              </p>
            ))}
          </div>
        </div>
      )}

      {data && (
        <div className="card !p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 dark:bg-ink-900 text-left">
              <tr className="text-xs uppercase tracking-wide text-ink-500">
                <th className="px-4 py-2.5 font-medium">City</th>
                <th className="px-4 py-2.5 font-medium text-right">Leads</th>
                <th className="px-4 py-2.5 font-medium text-right">Target</th>
                <th className="px-4 py-2.5 font-medium w-[170px]">Leads vs target</th>
                <th className="px-4 py-2.5 font-medium text-right">Spend</th>
                <th className="px-4 py-2.5 font-medium text-right">Budget</th>
                <th className="px-4 py-2.5 font-medium w-[170px]">Budget used</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const activeCampaigns = r.campaigns.filter((c) => c.status === "ACTIVE");
                const pct = r.progress === null ? null : Math.round(r.progress * 100);
                const bPct = r.budgetProgress === null ? null : Math.round(r.budgetProgress * 100);
                return (
                  <tr
                    key={r.cityName}
                    className="border-t border-ink-100 dark:border-ink-800 align-middle"
                    data-city={r.cityName}
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink-900 dark:text-ink-50">{r.cityName}</p>
                      <p
                        className={cn(
                          "text-xs mt-0.5",
                          r.status === "OVER"
                            ? "text-positive"
                            : r.status === "CLOSE"
                              ? "text-caution"
                              : "text-ink-500"
                        )}
                      >
                        {STATUS_LABEL[r.status]}
                        {r.campaigns.length > 0 && (
                          <>
                            {" · "}
                            {activeCampaigns.length} of {r.campaigns.length} active
                          </>
                        )}
                      </p>
                      {/* Budget is stated separately from the lead target, and
                          more loudly. Spend is money that has already gone;
                          a lead count is Meta's attributed estimate. */}
                      {r.budgetStatus === "EXHAUSTED" && (
                        <p className="text-xs font-semibold text-negative mt-0.5">
                          Budget exhausted — ₹{(r.spend - (r.budget ?? 0)).toLocaleString("en-IN")} over
                        </p>
                      )}
                      {r.budgetStatus === "CLOSE" && (
                        <p className="text-xs text-caution mt-0.5">
                          {Math.round((r.budgetProgress ?? 0) * 100)}% of budget spent
                          {r.projectedExhaustDate && <> · runs out around {shortDate(r.projectedExhaustDate)}</>}
                        </p>
                      )}
                      {r.budgetStatus === "WITHIN" && r.projectedExhaustDate && (
                        <p className="text-[11px] text-ink-500 mt-0.5">
                          At this rate the budget runs out around {shortDate(r.projectedExhaustDate)}
                        </p>
                      )}
                      {r.attributionSettings.length > 1 && (
                        <p className="text-[11px] text-caution mt-0.5">
                          Mixed attribution ({r.attributionSettings.join(", ")}) — this total adds up numbers
                          measured differently.
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-ink-900 dark:text-ink-50">
                      {r.leads.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3 text-right text-ink-600 dark:text-ink-300">
                      {r.target === null ? "—" : r.target.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3 w-[170px]">
                      {pct === null ? (
                        <span className="text-xs text-ink-500">no target</span>
                      ) : (
                        <Bar
                          pct={pct}
                          tone={r.status === "OVER" ? "over" : r.status === "CLOSE" ? "close" : "under"}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-ink-900 dark:text-ink-50">{inr(r.spend)}</td>
                    <td className="px-4 py-3 text-right text-ink-600 dark:text-ink-300">
                      {r.budget === null ? "—" : inr(r.budget)}
                    </td>
                    <td className="px-4 py-3 w-[170px]">
                      {bPct === null ? (
                        <span className="text-xs text-ink-500">no budget</span>
                      ) : (
                        <Bar
                          pct={bPct}
                          tone={
                            r.budgetStatus === "EXHAUSTED"
                              ? "over"
                              : r.budgetStatus === "CLOSE"
                                ? "close"
                                : "under"
                          }
                        />
                      )}
                    </td>
                    {/* One button, two reasons. Budget-exhausted is drawn as the
                        primary action because that spend is ongoing; target
                        reached is a goal met, which is a softer thing. */}
                    <td className="px-4 py-3 text-right">
                      {r.stopReason && activeCampaigns.length > 0 ? (
                        <button
                          className={cn(
                            "btn-sm !text-xs",
                            r.stopReason === "BUDGET" ? "btn-primary" : "btn-secondary"
                          )}
                          onClick={() => void pause(r)}
                          disabled={pausing === r.cityName}
                          title={
                            (r.stopReason === "BUDGET"
                              ? `Budget exhausted: ₹${r.spend.toLocaleString("en-IN")} of ₹${(r.budget ?? 0).toLocaleString("en-IN")}`
                              : `Target reached: ${r.leads} of ${r.target}`) +
                            "\n\n" +
                            activeCampaigns.map((c) => c.campaignName).join("\n")
                          }
                        >
                          <PauseCircle className="h-3.5 w-3.5" />
                          {pausing === r.cityName ? "Pausing…" : `Pause ${activeCampaigns.length}`}
                        </button>
                      ) : r.stopReason ? (
                        <span className="text-xs text-ink-500 inline-flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" /> already paused
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && data.notes.length > 0 && (
        <div className="mt-4 rounded-2xl border border-ink-200 dark:border-ink-800 p-4">
          <p className="text-xs font-semibold text-ink-700 dark:text-ink-200 mb-1.5 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> Ad sets not counted
          </p>
          {data.notes.map((n, i) => (
            <p key={i} className="text-xs text-ink-600 dark:text-ink-300">
              {n}
            </p>
          ))}
        </div>
      )}

      {data && (
        <p className="text-[11px] text-ink-500 mt-4">
          Counting <span className="font-mono">{data.actionType}</span> only — WhatsApp conversations and other
          result types are excluded, since they are not website leads. Cities come from each ad set&apos;s targeting,
          not from campaign names.
        </p>
      )}
    </div>
  );
}
