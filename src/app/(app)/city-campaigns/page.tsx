"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CityList } from "@/components/ui/CityList";
import { SearchSelect } from "@/components/ui/SearchSelect";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleAlert,
  Download,
  FileUp,
  Upload,
} from "lucide-react";
import { useFetch } from "@/lib/useFetch";
import { cn, inr, num } from "@/lib/format";

/**
 * Bulk city lists for non-catalogue campaigns.
 *
 * The shape of the screen follows the shape of the risk. Nothing is written
 * until the file has been parsed, every city resolved against Meta, and the
 * whole result shown as a table — accepted rows with the name Meta actually
 * matched, rejected rows with their line number and reason.
 *
 * A thirty-city file that silently becomes twenty-six is the failure this
 * module exists to prevent, so the counts are shown before the button and the
 * button names the number it is about to act on.
 */

interface AdSet {
  adSetId: string;
  name: string;
  status: string;
  cities: string[];
  otherPlaces: string[];
  dailyBudget: number;
}

interface Campaign {
  campaignId: string;
  name: string;
  status: string;
  objective: string;
  dailyBudget: number;
  adSets: AdSet[];
}

interface ResolvedCity {
  cityName: string;
  state: string | null;
  line: number;
  geoKey: string | null;
  metaName: string | null;
  region: string | null;
  problem: string | null;
  note: string | null;
  alreadyTargeted: boolean;
}

interface Preview {
  cities: ResolvedCity[];
  rejected: { line: number; raw: string; reason: string }[];
  notes: string[];
  headerless: boolean;
  source: {
    campaignName: string;
    creativeId: string | null;
    creativeBody: string | null;
    creativeLink: string | null;
    usesCatalogue: boolean;
    adSetName: string;
  } | null;
  counts: {
    parsed: number;
    rejected: number;
    resolved: number;
    unresolved: number;
    alreadyTargeted: number;
  };
  error?: string;
}

type Mode = "UPDATE" | "CREATE";

export default function CityCampaignsPage() {
  const router = useRouter();
  const { data: ctx, error: ctxError } = useFetch<{
    campaigns: Campaign[];
    template: string;
    error?: string;
  }>("/api/city-campaigns", []);

  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [mode, setMode] = useState<Mode | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [adSetId, setAdSetId] = useState("");
  const [newName, setNewName] = useState("");
  const [budgetRaw, setBudgetRaw] = useState("");
  const [activate, setActivate] = useState(false);
  const [confirmCount, setConfirmCount] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);

  const campaigns = ctx?.campaigns ?? [];
  const campaign = campaigns.find((c) => c.campaignId === campaignId) ?? null;
  const adSet = campaign?.adSets.find((a) => a.adSetId === adSetId) ?? null;

  const usable = useMemo(
    () => (preview?.cities ?? []).filter((c) => c.geoKey && !c.alreadyTargeted),
    [preview]
  );

  /**
   * Campaigns as rows an account manager can choose between.
   *
   * Delivering campaigns lead, because those are the ones an update actually
   * affects and the ones worth copying. Each row states its status, how many ad
   * sets it has — a campaign with three is a campaign where "which ad set" is a
   * real question — and its daily budget, so nobody has to open Ads Manager in
   * another tab to check they have the right one. The cities go into the search
   * keywords but not on screen: matching "Chennai" should find the Chennai
   * campaign even when the name is a date.
   */
  const campaignOptions = useMemo(() => {
    const row = (c: Campaign) => ({
      id: c.campaignId,
      label: c.name,
      sublabel: `${c.adSets.length} ad set${c.adSets.length === 1 ? "" : "s"}${
        c.dailyBudget > 0 ? ` · ₹${Math.round(c.dailyBudget).toLocaleString("en-IN")}/day` : ""
      }`,
      chips: [
        {
          text: c.status,
          tone: c.status === "ACTIVE" ? ("positive" as const) : ("neutral" as const),
        },
        ...(c.objective ? [{ text: c.objective.replace(/^OUTCOME_/, "").toLowerCase(), tone: "neutral" as const }] : []),
      ],
      group: c.status === "ACTIVE" ? "Delivering now" : "Paused",
      keywords: c.adSets.flatMap((a) => a.cities).join(" "),
    });
    const active = campaigns.filter((c) => c.status === "ACTIVE").map(row);
    const rest = campaigns.filter((c) => c.status !== "ACTIVE").map(row);
    return [...active, ...rest];
  }, [campaigns]);

  const adSetOptions = useMemo(
    () =>
      (campaign?.adSets ?? []).map((a) => ({
        id: a.adSetId,
        label: a.name,
        sublabel:
          a.cities.length > 0
            ? `${a.cities.length} ${a.cities.length === 1 ? "city" : "cities"}: ${a.cities.slice(0, 4).join(", ")}${
                a.cities.length > 4 ? "…" : ""
              }`
            : "No named city",
        chips: [
          { text: a.status, tone: a.status === "ACTIVE" ? ("positive" as const) : ("neutral" as const) },
        ],
        keywords: a.cities.join(" "),
      })),
    [campaign]
  );

  async function onFile(f: File) {
    const text = await f.text();
    setCsv(text);
    setFileName(f.name);
    setPreview(null);
    setResult(null);
    setError("");
  }

  async function runPreview() {
    if (!csv.trim()) {
      setError("Choose a CSV file first.");
      return;
    }
    if (!mode) {
      setError("Say whether this updates a running campaign or creates a new one.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/city-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv,
          adSetId: mode === "UPDATE" ? adSetId : null,
          existingCities: mode === "UPDATE" ? (adSet?.cities ?? []) : [],
          sourceCampaignId: campaignId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Could not read the file.");
      else setPreview(json as Preview);
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  }

  async function apply() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/city-campaigns", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          cities: usable.map((c) => ({ cityName: c.metaName ?? c.cityName, geoKey: c.geoKey })),
          adSetId: mode === "UPDATE" ? adSetId : undefined,
          sourceCampaignId: mode === "CREATE" ? campaignId : undefined,
          campaignName: newName,
          dailyBudget: Number(budgetRaw) || 0,
          activate,
          confirmation: confirmCount,
        }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Could not apply.");
      else setResult(json);
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  }

  // ---------------------------------------------------------------- result
  if (result) {
    const ok = result.ok !== false;
    return (
      <div className="max-w-3xl space-y-4">
        <div
          className={cn(
            "rounded-2xl border p-6",
            ok ? "border-positive/30 bg-positive/5" : "border-negative/40 bg-negative/5"
          )}
        >
          <div className="flex items-center gap-2 font-semibold mb-1">
            {ok ? <Check className="h-5 w-5 text-positive" /> : <CircleAlert className="h-5 w-5 text-negative" />}
            <span className={ok ? "text-positive" : "text-negative"}>
              {result.mode === "UPDATE"
                ? ok
                  ? `${result.added?.length ?? 0} ${(result.added?.length ?? 0) === 1 ? "city" : "cities"} added to ${result.adSetName}`
                  : "Nothing was changed"
                : ok
                  ? `${result.campaignName} created with ${result.cities?.length ?? 0} cities`
                  : "Nothing was created"}
            </span>
          </div>

          {result.mode === "UPDATE" && ok && (
            <div className="text-sm text-ink-700 dark:text-ink-200 mt-2 space-y-1">
              <p>
                <span className="text-ink-500">Was targeting:</span> {result.before?.join(", ") || "—"}
              </p>
              <p>
                <span className="text-ink-500">Now targeting:</span> {result.after?.join(", ") || "—"}
              </p>
              {result.skipped?.length > 0 && (
                <p className="text-ink-500 text-xs">
                  Already present, so not added again: {result.skipped.join(", ")}
                </p>
              )}
            </div>
          )}

          {result.mode === "CREATE" && ok && (
            <p className="text-xs font-mono text-ink-600 dark:text-ink-300 mt-2">
              campaign {result.campaignId}
              {result.adSetId && <> · ad set {result.adSetId}</>}
              {result.adId && <> · ad {result.adId}</>}
            </p>
          )}

          {!ok && <p className="text-sm text-ink-700 dark:text-ink-200 mt-2">{result.error}</p>}
          {result.rolledBack?.length > 0 && (
            <p className="text-xs text-ink-500 mt-1">Rolled back: {result.rolledBack.join(", ")}</p>
          )}
        </div>

        {result.notes?.length > 0 && (
          <div className="rounded-2xl border border-caution/40 bg-caution/5 p-4 space-y-1.5">
            {result.notes.map((n: string, i: number) => (
              <p key={i} className="text-xs text-ink-700 dark:text-ink-200">
                {n}
              </p>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => router.push("/campaigns")}>
            View campaigns <ArrowRight className="h-4 w-4" />
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              setResult(null);
              setPreview(null);
              setCsv("");
              setFileName("");
              setConfirmCount("");
            }}
          >
            Upload another list
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- form
  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-900 dark:text-ink-50">Bulk cities from a file</h1>
        <p className="text-sm text-ink-500 mt-0.5">
          Upload a city list and either add it to a campaign that is already running, or create a new one from an
          existing campaign&apos;s settings.
        </p>
        <p className="text-xs text-ink-500 mt-1">
          For non-catalogue campaigns. A catalogue ad draws from a product set tied to one city, so those still go
          through Replicate.
        </p>
      </div>

      {(ctxError || ctx?.error) && (
        <div className="rounded-2xl border border-negative/40 bg-negative/5 p-4">
          <p className="text-sm font-semibold text-negative">Could not read your campaigns</p>
          <p className="text-sm text-ink-700 dark:text-ink-200 mt-1">{ctxError ?? ctx?.error}</p>
        </div>
      )}

      {/* 1 — the file */}
      <div className="card p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="font-semibold text-ink-900 dark:text-ink-50">1. The city list</h2>
          <button
            className="btn-secondary btn-sm !text-xs"
            onClick={() => {
              const blob = new Blob([ctx?.template ?? "city,state\n"], { type: "text/csv" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "city-list-template.csv";
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            <Download className="h-3.5 w-3.5" /> Template
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
        <button
          className="w-full rounded-xl border border-dashed border-ink-300 dark:border-ink-700 p-6 text-center hover:bg-ink-50 dark:hover:bg-ink-900"
          onClick={() => fileRef.current?.click()}
        >
          <FileUp className="h-5 w-5 mx-auto text-ink-400 mb-1.5" />
          <span className="text-sm text-ink-700 dark:text-ink-200">
            {fileName || "Choose a CSV file"}
          </span>
          <span className="block text-xs text-ink-500 mt-0.5">
            One column named <span className="font-mono">city</span>, optionally one named{" "}
            <span className="font-mono">state</span>. Order does not matter.
          </span>
        </button>
      </div>

      {/* 2 — where it goes */}
      <div className="card p-5">
        <h2 className="font-semibold text-ink-900 dark:text-ink-50 mb-3">2. Where these cities go</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {(
            [
              {
                id: "UPDATE" as Mode,
                title: "Add to a running campaign",
                detail: "The cities are added to an existing ad set's targeting. Nothing new is created.",
              },
              {
                id: "CREATE" as Mode,
                title: "Create a new campaign",
                detail: "A new campaign and ad set covering every city, copying an existing campaign's settings.",
              },
            ]
          ).map((o) => (
            <button
              key={o.id}
              onClick={() => {
                setMode(o.id);
                setPreview(null);
              }}
              className={cn(
                "rounded-xl border p-3.5 text-left",
                mode === o.id
                  ? "border-brand-600 bg-brand-50 dark:bg-brand-950"
                  : "border-ink-200 dark:border-ink-800 hover:bg-ink-50 dark:hover:bg-ink-900"
              )}
            >
              <p className="text-sm font-medium text-ink-900 dark:text-ink-50">{o.title}</p>
              <p className="text-xs text-ink-600 dark:text-ink-300 mt-0.5">{o.detail}</p>
            </button>
          ))}
        </div>

        {mode && (
          <div className="mt-4 space-y-3">
            <SearchSelect
              label={mode === "UPDATE" ? "Campaign to add them to" : "Campaign to copy settings from"}
              placeholder="Search your campaigns by name…"
              emptyText="No campaign matches that. Try part of the city name, or the date in the campaign name."
              hint={
                mode === "UPDATE"
                  ? "Delivering campaigns are listed first. Adding cities changes a campaign that is already spending, so check the name before you continue."
                  : "The new campaign copies this one's objective, optimisation, attribution and creative. Only its cities and budget differ."
              }
              options={campaignOptions}
              value={campaignId}
              onChange={(id) => {
                setCampaignId(id);
                setAdSetId("");
                setPreview(null);
              }}
            />

            {mode === "UPDATE" && campaign && (
              <div>
                <SearchSelect
                  label="Ad set"
                  placeholder="Choose the ad set these cities join…"
                  emptyText="This campaign has no ad set matching that."
                  options={adSetOptions}
                  value={adSetId}
                  onChange={(id) => {
                    setAdSetId(id);
                    setPreview(null);
                  }}
                />
                {adSet && (
                  <p className="text-xs text-ink-500 mt-1.5">
                    Currently targets: {adSet.cities.length > 0 ? <CityList cities={adSet.cities} preview={5} /> : "no named city"}
                    {adSet.otherPlaces.length > 0 && <> · also {adSet.otherPlaces.join(", ")}</>}
                  </p>
                )}
              </div>
            )}

            {mode === "CREATE" && (
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">New campaign name</label>
                  <input
                    className="input"
                    value={newName}
                    placeholder="UC | META | LEAD | NORTH | LAUNCH"
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Daily budget for the campaign</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="input"
                    value={budgetRaw}
                    placeholder={campaign ? String(Math.round(campaign.dailyBudget)) : "2000"}
                    onChange={(e) => setBudgetRaw(e.target.value.replace(/[^\d.]/g, ""))}
                  />
                  <p className="text-xs text-ink-500 mt-1">
                    One budget for the whole campaign, not per city.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3 — check */}
      <div className="card p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="font-semibold text-ink-900 dark:text-ink-50">3. Check before anything is written</h2>
          <button className="btn-secondary" onClick={() => void runPreview()} disabled={busy || !csv || !mode}>
            <Upload className={cn("h-4 w-4", busy && "animate-pulse")} /> {busy ? "Checking…" : "Check the list"}
          </button>
        </div>

        {error && <p className="text-sm text-negative mb-3">{error}</p>}

        {!preview && (
          <p className="text-sm text-ink-500">
            Every city is resolved against Meta first. Nothing is created or changed by this step.
          </p>
        )}

        {preview && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="chip chip-positive">{preview.counts.resolved} will be used</span>
              {preview.counts.alreadyTargeted > 0 && (
                <span className="chip chip-neutral">{preview.counts.alreadyTargeted} already targeted</span>
              )}
              {preview.counts.unresolved > 0 && (
                <span className="chip chip-negative">{preview.counts.unresolved} could not be resolved</span>
              )}
              {preview.counts.rejected > 0 && (
                <span className="chip chip-caution">{preview.counts.rejected} rows rejected</span>
              )}
            </div>

            {preview.notes.map((n, i) => (
              <p key={i} className="text-xs text-ink-600 dark:text-ink-300 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-caution shrink-0 mt-0.5" />
                {n}
              </p>
            ))}

            {preview.source?.creativeBody && (
              <div className="rounded-xl border border-ink-200 dark:border-ink-800 p-3">
                <p className="text-xs text-ink-500 mb-1">
                  The new ad will reuse this creative from {preview.source.campaignName}, unchanged:
                </p>
                <p className="text-sm text-ink-800 dark:text-ink-100">“{preview.source.creativeBody}”</p>
                {preview.source.creativeLink && (
                  <p className="text-xs text-ink-500 mt-1 font-mono break-all">{preview.source.creativeLink}</p>
                )}
                <p className="text-xs text-caution mt-1.5">
                  If that copy or link names a city, it still will for every city in this list.
                </p>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full table-clean">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>In your file</th>
                    <th>Meta matched</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.cities.map((c) => (
                    <tr key={`${c.line}-${c.cityName}`}>
                      <td className="text-ink-400 tabular-nums">{c.line}</td>
                      <td className="text-ink-800 dark:text-ink-100">
                        {c.cityName}
                        {c.state && <span className="text-ink-500"> · {c.state}</span>}
                      </td>
                      <td className="text-ink-700 dark:text-ink-200">
                        {c.metaName ? (
                          <>
                            {c.metaName}
                            {c.region && <span className="text-ink-500"> · {c.region}</span>}
                          </>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                      <td className="text-xs">
                        {c.problem ? (
                          <span className="text-negative">{c.problem}</span>
                        ) : c.alreadyTargeted ? (
                          <span className="text-ink-500">Already targeted — will be skipped</span>
                        ) : c.note ? (
                          <span className="text-caution">{c.note}</span>
                        ) : (
                          <span className="text-positive">Ready</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {preview.rejected.map((r) => (
                    <tr key={`r-${r.line}`}>
                      <td className="text-ink-400 tabular-nums">{r.line}</td>
                      <td className="text-ink-500 font-mono text-xs truncate max-w-[220px]">{r.raw}</td>
                      <td className="text-ink-400">—</td>
                      <td className="text-xs text-negative">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 4 — apply */}
      {preview && usable.length > 0 && (
        <div className="card p-5">
          <h2 className="font-semibold text-ink-900 dark:text-ink-50 mb-1">4. Apply</h2>
          <p className="text-sm text-ink-600 dark:text-ink-300 mb-3">
            {mode === "UPDATE" ? (
              <>
                {usable.length} {usable.length === 1 ? "city" : "cities"} will be added to{" "}
                <span className="font-medium">{adSet?.name}</span>. Existing cities are kept — this only adds.
              </>
            ) : (
              <>
                A new campaign covering {usable.length} {usable.length === 1 ? "city" : "cities"} at{" "}
                {inr(Number(budgetRaw) || 0)}/day.
              </>
            )}
          </p>

          {mode === "UPDATE" && (
            <p className="text-xs text-caution mb-3">
              Editing a running ad set&apos;s targeting restarts Meta&apos;s learning phase for it. Delivery and cost
              per result will be unstable for a few days afterwards.
            </p>
          )}

          {mode === "CREATE" && (
            <label className="flex items-start gap-2.5 mb-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 accent-brand-600"
                checked={activate}
                onChange={(e) => setActivate(e.target.checked)}
              />
              <span className="text-sm text-ink-700 dark:text-ink-200">
                Switch it on immediately.{" "}
                <span className="text-ink-500">
                  Left unticked it is created paused, which is the safe default — check it in Ads Manager, then start it
                  there.
                </span>
              </span>
            </label>
          )}

          <div className="flex items-end gap-2">
            <div>
              <label className="label">Type {usable.length} to confirm</label>
              <input
                className="input w-28"
                value={confirmCount}
                onChange={(e) => setConfirmCount(e.target.value)}
                placeholder={String(usable.length)}
              />
            </div>
            <button
              className="btn-primary"
              onClick={() => void apply()}
              disabled={busy || confirmCount.trim() !== String(usable.length)}
            >
              {mode === "UPDATE"
                ? `Add ${usable.length} to the ad set`
                : `Create with ${usable.length} ${usable.length === 1 ? "city" : "cities"}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
