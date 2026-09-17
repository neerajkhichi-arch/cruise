"use client";

/**
 * Replicate a campaign into new cities.
 *
 * Three steps: pick the source, name the cities, review. Everything else is
 * lifted from the source, so the only things typed are city names.
 *
 * The gates still run per city and a blocked city is skipped rather than
 * silently created — replication saves typing, not checks.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useFetch } from "@/lib/useFetch";
import { AudienceSelector } from "@/components/AudienceSelector";
import { inr, num, cn } from "@/lib/format";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  Plus,
  Send,
  X,
} from "lucide-react";
import { buildReplicationPlan, type ReplicationSource } from "@/lib/engine/replicate";
import type { AdSetSettings } from "@/lib/engine/classify";

const STEPS = ["Source", "Cities", "Review"];

interface Ctx {
  sources: ReplicationSource[];
  catalogues: { catalogueId: string; name: string; vertical: "vehicles" | "commerce"; inUse: boolean }[];
  productSets: {
    productSetId: string;
    catalogueId: string;
    name: string;
    productCount: number;
    filterRule: string;
    cityKey: string | null;
  }[];
  defaultCatalogueId: string;
  knownCities: { name: string; state: string; tier: string }[];
  existingCityNames: string[];
  adSetSettings: AdSetSettings[];
}

export default function ReplicatePage() {
  const router = useRouter();
  const { data: ctx } = useFetch<Ctx>("/api/replicate");

  const [step, setStep] = useState(0);
  const [sourceId, setSourceId] = useState("");
  const [cityInput, setCityInput] = useState("");
  const [cityNames, setCityNames] = useState<string[]>([]);
  const [manualStates, setManualStates] = useState<Record<string, string>>({});
  // What distinguishes a second campaign in a city already running one.
  const [labels, setLabels] = useState<Record<string, string>>({});
  // Product sets the operator creates in Commerce Manager while working through
  // the batch. Without this, every genuinely new city blocks with no way out.
  const [manualSets, setManualSets] = useState<Record<string, { productSetId: string; name: string; productCount: number }>>({});
  const [budgetOverride, setBudgetOverride] = useState<number | null>(null);
  const [ceilingOverride, setCeilingOverride] = useState<number | null>(null);
  // The raw text, kept separately so the field can be emptied mid-edit without
  // the value collapsing to 0 under the operator.
  const [budgetRaw, setBudgetRaw] = useState("");
  const [ceilingRaw, setCeilingRaw] = useState("");
  const [pixelVerified, setPixelVerified] = useState(false);
  // Existing Meta audiences chosen for this batch. Targeted ones go into a
  // second campaign per city; excluded ones ride along on every campaign.
  const [audInclude, setAudInclude] = useState<string[]>([]);
  const [audExclude, setAudExclude] = useState<string[]>([]);
  const [twinEnabled, setTwinEnabled] = useState(false);
  const [twinBudgetRaw, setTwinBudgetRaw] = useState("");
  // One campaign covering every city in the batch, instead of one each.
  const [consolidate, setConsolidate] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [creatingSet, setCreatingSet] = useState<string | null>(null);
  const [setErrors, setSetErrors] = useState<Record<string, string>>({});
  const [destination, setDestination] = useState<"META_PAUSED" | "META_ACTIVE" | "PLATFORM">("META_PAUSED");
  const [confirmCount, setConfirmCount] = useState("");

  /**
   * Create the missing product set in the catalogue and record it, so a blocked
   * city can be unblocked without leaving the screen. The vehicle count comes
   * back from Meta rather than being assumed — a set matching eleven cars is
   * something to see before launching, not after.
   */
  async function createProductSet(cityName: string) {
    const key = cityName.toLowerCase();
    setCreatingSet(cityName);
    setSetErrors({ ...setErrors, [key]: "" });
    try {
      const r = await fetch("/api/product-set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cityName }),
      });
      const j = (await r.json()) as {
        productSetId?: string;
        name?: string;
        productCount?: number;
        error?: string;
        filterRule?: string;
      };
      if (!r.ok || !j.productSetId) {
        setSetErrors({
          ...setErrors,
          [key]: j.error ?? "Could not create the product set.",
        });
        return;
      }
      setManualSets({
        ...manualSets,
        [key]: {
          productSetId: j.productSetId,
          name: j.name ?? `${cityName} Catalogue`,
          productCount: j.productCount ?? 0,
        },
      });
    } catch (e) {
      setSetErrors({ ...setErrors, [key]: e instanceof Error ? e.message : String(e) });
    } finally {
      setCreatingSet(null);
    }
  }
  const [result, setResult] = useState<any>(null);

  const source = ctx?.sources.find((s) => s.campaignId === sourceId) ?? null;
  const dailyBudget = budgetOverride ?? source?.dailyBudget ?? 0;
  const ceiling = ceilingOverride ?? source?.targetCpl ?? 0;

  const catalogue = useMemo(() => {
    if (!ctx) return null;
    const id = source?.catalogueId ?? ctx.defaultCatalogueId;
    const c = ctx.catalogues.find((x) => x.catalogueId === id);
    return c ? { catalogueId: c.catalogueId, catalogueName: c.name, vertical: c.vertical, inUse: c.inUse } : null;
  }, [ctx, source?.catalogueId]);

  const plan = useMemo(() => {
    if (!ctx || !source || cityNames.length === 0) return null;
    return buildReplicationPlan({
      source,
      cityNames,
      dailyBudget,
      cplCeiling: ceiling,
      pixelVerified,
      existingCityNames: ctx.existingCityNames,
      existingAdSets: ctx.adSetSettings,
      catalogue,
      productSets: ctx.productSets,
      manualStates,
      manualProductSets: manualSets,
      labels,
    });
  }, [ctx, source, cityNames, dailyBudget, ceiling, pixelVerified, catalogue, manualStates, manualSets, labels]);

  /**
   * Cities already in the platform used to be filtered out of this list
   * entirely. Typing "Mohali" then returned nothing, which reads as "we don't
   * know that city" rather than "you already run it" — and left no way to see
   * why. They are shown now, labelled, and only the ones already added to this
   * batch are hidden.
   */
  const suggestions = useMemo(() => {
    if (!ctx || !cityInput.trim()) return [];
    const q = cityInput.trim().toLowerCase();
    const inBatch = new Set(cityNames.map((c) => c.toLowerCase()));
    const running = new Set(ctx.existingCityNames.map((c) => c.toLowerCase()));
    return ctx.knownCities
      .filter((c) => c.name.toLowerCase().includes(q) && !inBatch.has(c.name.toLowerCase()))
      .map((c) => ({ ...c, alreadyRunning: running.has(c.name.toLowerCase()) }))
      // Cities you don't yet run are the ones you're usually after, so they
      // sort first rather than being buried under the ones you do.
      .sort((a, b) => Number(a.alreadyRunning) - Number(b.alreadyRunning))
      .slice(0, 6);
  }, [ctx, cityInput, cityNames, ctx?.existingCityNames]);

  function addCity(name: string) {
    const n = name.trim();
    if (!n || cityNames.some((c) => c.toLowerCase() === n.toLowerCase())) return;
    setCityNames([...cityNames, n]);
    setCityInput("");
  }

  async function run() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/replicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceCampaignId: sourceId,
          cityNames: plan?.launchable.map((t) => t.cityName) ?? [],
          dailyBudget,
          cplCeiling: ceiling,
          pixelVerified,
          catalogueId: catalogue?.catalogueId,
          manualStates,
          manualProductSets: manualSets,
          labels,
          audiences: { include: audInclude, exclude: audExclude },
          remarketingTwin: { enabled: twinEnabled, dailyBudget: Number(twinBudgetRaw) || 0 },
          consolidate: { enabled: consolidate, groupName: groupName.trim() },
          destination: destination === "PLATFORM" ? "PLATFORM" : "META",
          activate: destination === "META_ACTIVE",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Replication failed.");
        setBusy(false);
        return;
      }
      setResult(json);
    } catch {
      setError("Replication failed — could not reach the server.");
    }
    setBusy(false);
  }

  // ------------------------------------------------------------------ done
  // A consolidated run creates ONE campaign, so it reports differently from the
  // per-city batch below rather than being squeezed into a list of one.
  if (result?.consolidated) {
    return (
      <div className="max-w-3xl">
        <div
          className={cn(
            "rounded-2xl border p-6 mb-4",
            result.ok ? "border-positive/30 bg-positive/5" : "border-negative/40 bg-negative/5"
          )}
        >
          <div className="flex items-center gap-2 font-semibold mb-1">
            {result.ok ? (
              <>
                <Check className="h-5 w-5 text-positive" />
                <span className="text-positive">
                  One campaign created for {result.cities?.length ?? 0} cities
                </span>
              </>
            ) : (
              <>
                <CircleAlert className="h-5 w-5 text-negative" />
                <span className="text-negative">Nothing was created</span>
              </>
            )}
          </div>
          <p className="text-sm text-ink-600 dark:text-ink-300">
            {result.groupName} — {(result.cities ?? []).join(", ")}
          </p>
          {result.ok && (
            <p className="text-xs text-ink-600 dark:text-ink-300 mt-2 font-mono">
              campaign {result.campaignId}
              {result.adSetId && <> · ad set {result.adSetId}</>}
              {result.adId && <> · ad {result.adId}</>}
            </p>
          )}
          {result.productSetId && (
            <p className="text-xs text-ink-500 mt-1">
              Product set {result.productSetName ?? result.productSetId} · {num(result.productCount ?? 0)} vehicles
              across all {result.cities?.length ?? 0} cities.
            </p>
          )}
          {!result.ok && <p className="text-sm text-ink-700 dark:text-ink-200 mt-2">{result.error}</p>}
          {result.rolledBack?.length > 0 && (
            <p className="text-xs text-ink-500 mt-1">Rolled back: {result.rolledBack.join(", ")}</p>
          )}
        </div>

        {result.notes?.length > 0 && (
          <div className="rounded-2xl border border-ink-200 dark:border-ink-800 p-4 mb-6 space-y-1.5">
            {result.notes.map((n: string, i: number) => (
              <p key={i} className="text-xs text-ink-600 dark:text-ink-300">
                {n}
              </p>
            ))}
          </div>
        )}

        <button className="btn-primary" onClick={() => router.push("/campaigns")}>
          View campaigns <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (result) {
    return (
      <div className="max-w-3xl">
        {/* This screen used to say "launched", which reads as "live in Meta".
            Replicate only writes to this platform — nothing here has touched
            the ad account. Saying so is the whole point of the panel.

            A green tick over "0 cities created" is the same failure in a
            smaller form: nothing succeeded, so nothing should look like
            success. When every city was refused, the run gets a plain header
            and the refusal panel below carries the whole story. */}
        {result.created.length > 0 ? (
          <div className="rounded-2xl border border-positive/30 bg-positive/5 p-6 mb-4">
            <div className="flex items-center gap-2 text-positive font-semibold mb-1">
              <Check className="h-5 w-5" /> {result.created.length}{" "}
              {result.created.length === 1 ? "city" : "cities"}{" "}
              {result.destination === "META" ? "created in Meta" : "prepared"} from {result.source.name}
            </div>
            <p className="text-sm text-ink-600 dark:text-ink-300">
              {inr(result.totalDailyBudget)}/day {result.activated ? "committed" : "planned"} across the batch.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-ink-200 dark:border-ink-800 p-6 mb-4">
            <div className="font-semibold mb-1 text-ink-900 dark:text-ink-50">
              Nothing was created from {result.source.name}
            </div>
            <p className="text-sm text-ink-600 dark:text-ink-300">
              Every city in this run was refused. Nothing was written to the ad
              account and nothing was recorded here.
            </p>
          </div>
        )}

        {result.destination === "META" && result.created.length > 0 ? (
          <div className="rounded-2xl border border-ink-200 dark:border-ink-800 p-5 mb-6">
            <p className="font-semibold text-sm text-ink-900 dark:text-ink-50">
              {result.activated
                ? "Live in Meta — these are delivering"
                : "Created in Meta, paused — nothing is spending yet"}
            </p>
            <p className="text-xs text-ink-600 dark:text-ink-300 mt-1">
              {result.activated
                ? "Find them in Ads Manager under the campaign names below. Pause anything that looks wrong before it accumulates spend."
                : "Open them in Ads Manager, check the targeting and creative, then switch them on there when you are satisfied."}
            </p>
            <div className="mt-3 space-y-1">
              {result.created.map((c: any) =>
                c.meta ? (
                  <p key={c.campaignId} className="text-xs text-ink-700 dark:text-ink-200">
                    {c.cityName} — campaign <span className="font-mono">{c.meta.campaignId}</span>
                    {c.meta.adSetId && (
                      <>
                        , ad set <span className="font-mono">{c.meta.adSetId}</span>
                      </>
                    )}
                    {c.meta.audienceId && (
                      <>
                        , audience <span className="font-mono">{c.meta.audienceId}</span>
                      </>
                    )}
                  </p>
                ) : null
              )}
            </div>
          </div>
        ) : /* Only when the run was actually a prepare-only run.
               This used to be a bare `else`, so a META run where every city was
               refused fell through to it and told the operator "You chose to
               prepare only" — a choice he had not made — directly above the
               panel saying Meta had refused. Blaming a failure on a setting the
               user never touched is worse than saying nothing, and the refusal
               panel below already carries the whole story. */
        result.destination !== "META" && result.created.length > 0 ? (
          <div className="rounded-2xl border border-caution/40 bg-caution/5 p-5 mb-6">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-caution mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-sm text-ink-900 dark:text-ink-50">
                  Not created in Meta — these exist only in this platform
                </p>
                <p className="text-xs text-ink-600 dark:text-ink-300 mt-1">
                  You chose to prepare only. Nothing has been sent to Ads Manager, so you will not find these
                  campaigns there.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {result.created.map((c: any) => (
                    <button
                      key={c.campaignId}
                      className="btn-secondary btn-sm !text-xs"
                      onClick={() =>
                        router.push(
                          `/campaigns/publish?city=${encodeURIComponent(c.cityName)}&source=${encodeURIComponent(
                            result.source.campaignId
                          )}`
                        )
                      }
                    >
                      <Send className="h-3.5 w-3.5" /> Publish {c.cityName} to Meta
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* The audience-based second campaigns. Listed separately from the broad
            ones, because they are a different kind of buy — merging the two
            lists would hide that a city now carries two budgets. */}
        {result.twins?.length > 0 && (
          <div className="rounded-2xl border border-brand-300 dark:border-brand-800 bg-brand-50/50 dark:bg-brand-950/30 p-5 mb-6">
            <p className="font-semibold text-sm text-ink-900 dark:text-ink-50 mb-1">
              {result.twins.length} remarketing {result.twins.length === 1 ? "campaign" : "campaigns"} also created
            </p>
            <p className="text-xs text-ink-600 dark:text-ink-300 mb-2">
              These target the audiences you chose. They will show as REMARKETING throughout Cruise, because funnel
              stage is read from the ad set&apos;s settings rather than from its name.
            </p>
            {result.twins.map((t: any) => (
              <p key={t.campaignId} className="text-xs text-ink-700 dark:text-ink-200">
                {t.cityName} — <span className="font-mono">{t.campaignName}</span> ({t.campaignId})
              </p>
            ))}
          </div>
        )}

        {result.metaNotes?.length > 0 && (
          <div className="rounded-2xl border border-ink-200 dark:border-ink-800 p-4 mb-6 space-y-1">
            {result.metaNotes.map((n: string, i: number) => (
              <p key={i} className="text-xs text-ink-600 dark:text-ink-300">
                {n}
              </p>
            ))}
          </div>
        )}

        {result.metaFailures?.length > 0 && (
          <div className="rounded-2xl border border-negative/40 bg-negative/5 p-5 mb-6">
            <p className="font-semibold text-sm text-negative mb-2">
              {result.metaFailures.length} {result.metaFailures.length === 1 ? "city" : "cities"} Meta refused
            </p>
            {result.metaFailures.map((f: any) => (
              <div key={f.cityName} className="mb-2 last:mb-0">
                <p className="text-xs text-ink-700 dark:text-ink-200">
                  <span className="font-semibold">{f.cityName}</span> — {f.error}
                </p>
                {f.rolledBack?.length > 0 && (
                  <p className="text-xs text-ink-500 mt-0.5">Rolled back: {f.rolledBack.join(", ")}</p>
                )}
              </div>
            ))}
            <p className="text-xs text-ink-500 mt-2">
              Nothing partial was left behind, and these cities were not recorded here either.
            </p>
          </div>
        )}

        <div className="rounded-xl border border-ink-200 dark:border-ink-800 overflow-hidden mb-6">
          {result.created.map((c: any) => (
            <div key={c.campaignId} className="p-4 border-b border-ink-200 dark:border-ink-800 last:border-0">
              <p className="font-semibold text-ink-900 dark:text-ink-50">{c.cityName}</p>
              <p className="text-xs font-mono text-ink-500 mt-0.5">{c.campaignName}</p>
              <div className="mt-2 space-y-1">
                {c.adSets.map((a: any) => (
                  <p key={a.id} className="text-xs text-ink-600 dark:text-ink-300">
                    {a.name}
                    {a.productSetName ? ` · ${a.productSetName} (${num(a.productCount)} vehicles)` : ""}
                  </p>
                ))}
              </div>
              <p className="text-xs text-ink-500 mt-2">
                Create audience <span className="font-mono">{c.pvAudience}</span>
              </p>
            </div>
          ))}
        </div>

        {result.skipped?.length > 0 && (
          <div className="rounded-xl border border-caution/40 bg-caution/5 p-4 mb-6">
            <p className="text-sm font-semibold text-ink-900 dark:text-ink-50 mb-2">
              {result.skipped.length} skipped
            </p>
            {result.skipped.map((s: any) => (
              <p key={s.cityName} className="text-xs text-ink-600 dark:text-ink-300">
                <span className="font-semibold">{s.cityName}</span> — {s.reason}
              </p>
            ))}
          </div>
        )}

        <button onClick={() => router.push("/campaigns")} className="btn-primary">
          View campaigns <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------- wizard
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-extrabold text-ink-900 dark:text-ink-50">Replicate a campaign</h1>
        <p className="text-sm text-ink-500 mt-0.5">
          Takes every setting from an existing campaign. You name the cities; the state, product set and geo are
          resolved per city.
        </p>
      </div>

      <ol className="flex items-center gap-1 mb-6">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            <span
              className={cn(
                "text-xs font-semibold px-2.5 py-1 rounded-md",
                i === step
                  ? "bg-brand-600 text-white"
                  : i < step
                  ? "bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300"
                  : "text-ink-400"
              )}
            >
              {s}
            </span>
            {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-ink-300" />}
          </li>
        ))}
      </ol>

      <div className="rounded-2xl border border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-950 p-6 shadow-card">
        {/* ------------------------------------------------ 0. Source */}
        {step === 0 && (
          <div>
            <h2 className="font-bold text-ink-900 dark:text-ink-50 mb-1">Which campaign?</h2>
            <p className="text-sm text-ink-500 mb-4">
              Its ad set structure, targeting, budget and ceiling become the template. Geo and the product set are the
              two things replaced per city.
            </p>
            <div className="space-y-2">
              {ctx?.sources.map((s) => (
                <button
                  key={s.campaignId}
                  onClick={() => setSourceId(s.campaignId)}
                  className={cn(
                    "w-full text-left p-4 rounded-xl border",
                    sourceId === s.campaignId
                      ? "border-brand-600 bg-brand-50 dark:bg-brand-950"
                      : "border-ink-200 dark:border-ink-800"
                  )}
                >
                  <p className="font-semibold text-sm text-ink-900 dark:text-ink-50">{s.name}</p>
                  <p className="text-xs text-ink-500 mt-0.5">
                    {s.cities.join(", ") || "no city"} · {s.adSets.length} ad set
                    {s.adSets.length === 1 ? "" : "s"} ({s.adSets.map((a) => a.kind.toLowerCase()).join(", ")}) ·{" "}
                    {inr(s.dailyBudget)}/day · ceiling {inr(s.targetCpl)}
                  </p>
                  <p className="text-xs font-mono text-ink-400 mt-0.5">
                    {s.resultType} · {s.attributionSetting}
                    {s.catalogueName ? ` · ${s.catalogueName}` : " · no catalogue"}
                  </p>
                  {s.cautions.length > 0 && sourceId === s.campaignId && (
                    <div className="mt-2 space-y-1">
                      {s.cautions.map((c) => (
                        <p key={c} className="text-xs text-caution flex items-start gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          {c}
                        </p>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ------------------------------------------------ 1. Cities */}
        {step === 1 && source && (
          <div>
            <h2 className="font-bold text-ink-900 dark:text-ink-50 mb-1">Which cities?</h2>
            <p className="text-sm text-ink-500 mb-4">
              Type a city and press Enter. The state fills in automatically, and the product set is matched from{" "}
              {catalogue?.catalogueName ?? "the catalogue"} by the city filter.
            </p>

            <div className="relative mb-3">
              <input
                className="input"
                value={cityInput}
                onChange={(e) => setCityInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCity(suggestions[0]?.name ?? cityInput);
                  }
                }}
                placeholder="Lucknow, Jaipur, Indore…"
              />
              {suggestions.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 rounded-xl border border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-950 shadow-card overflow-hidden">
                  {suggestions.map((c) => (
                    <button
                      key={c.name}
                      onClick={() => addCity(c.name)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-ink-50 dark:hover:bg-ink-900 flex items-center justify-between"
                    >
                      <span className="text-ink-900 dark:text-ink-50">
                        {c.name}
                        {c.alreadyRunning && (
                          <span className="ml-2 text-xs font-normal text-caution">already running</span>
                        )}
                      </span>
                      <span className="text-xs text-ink-500">{c.state}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {plan && (
              <div className="space-y-2 mb-4">
                {plan.targets.map((t) => {
                  const blocking = t.plan.gates.filter((g) => g.status === "BLOCK");
                  return (
                    <div
                      key={t.cityName}
                      data-city={t.cityName}
                      className={cn(
                        "p-3.5 rounded-xl border",
                        blocking.length > 0
                          ? "border-negative/40 bg-negative/5"
                          : t.alreadyExists
                            ? "border-caution/40 bg-caution/5"
                            : "border-ink-200 dark:border-ink-800"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-ink-900 dark:text-ink-50">
                            {t.cityName}
                            <span className="ml-2 text-xs font-normal text-ink-500">{t.state ?? "state unknown"}</span>
                          </p>
                          <p className="text-xs text-ink-500 mt-0.5">
                            {t.productSet
                              ? `${t.productSet.name} · ${num(t.productSet.productCount)} vehicles`
                              : `No product set — create one filtered on ${t.expectedFilterRule}`}
                          </p>
                          {/* A city already running is no longer refused. It needs a
                              label so the two campaigns can be told apart in Ads
                              Manager — and a warning, because they bid against each
                              other for the same people. */}
                          {t.alreadyExists && (
                            <div className="mt-1.5">
                              <p className="text-xs text-caution">
                                {t.cityName} already has a campaign. Name this one so you can tell them apart.
                              </p>
                              <input
                                className="input mt-1.5 max-w-[280px]"
                                placeholder="Dealer or test name, e.g. Big Boy Toyz"
                                value={labels[t.cityName.toLowerCase()] ?? ""}
                                onChange={(e) =>
                                  setLabels({ ...labels, [t.cityName.toLowerCase()]: e.target.value })
                                }
                              />
                              {labels[t.cityName.toLowerCase()]?.trim() && (
                                <p className="text-[11px] text-ink-500 mt-1 font-mono break-all">
                                  UC | META | LEAD | {t.cityName.toUpperCase()} | CATALOGUE | LAUNCH |{" "}
                                  {labels[t.cityName.toLowerCase()].trim().toUpperCase()}
                                </p>
                              )}
                            </div>
                          )}
                          {blocking.map((g) => (
                            <p key={g.id} className="text-xs text-negative mt-1">
                              {g.title}: {g.detail}
                            </p>
                          ))}
                          {!t.state && (
                            <input
                              className="input mt-2 max-w-[220px]"
                              placeholder="State"
                              value={manualStates[t.cityName.toLowerCase()] ?? ""}
                              onChange={(e) =>
                                setManualStates({ ...manualStates, [t.cityName.toLowerCase()]: e.target.value })
                              }
                            />
                          )}
                          {/* The editor stays open while the operator is still typing a
                              set they recorded by hand. Hiding it the moment the set
                              resolves made the vehicle count impossible to enter. */}
                          {(!t.productSet || Boolean(manualSets[t.cityName.toLowerCase()]?.productSetId?.trim())) && (
                            <div className="mt-2">
                              <p className="text-xs text-ink-500 mb-1.5">
                                {t.productSet
                                  ? "Recorded by hand — correct it here if anything is wrong:"
                                  : `Create it in ${catalogue?.catalogueName ?? "the catalogue"} with that filter, then record it:`}
                              </p>
                              <div className="grid grid-cols-3 gap-2 max-w-[440px]">
                                <input
                                  className="input !py-1.5 !text-xs"
                                  placeholder="Set ID"
                                  value={manualSets[t.cityName.toLowerCase()]?.productSetId ?? ""}
                                  onChange={(e) =>
                                    setManualSets({
                                      ...manualSets,
                                      [t.cityName.toLowerCase()]: {
                                        ...(manualSets[t.cityName.toLowerCase()] ?? { name: "", productCount: 0 }),
                                        productSetId: e.target.value,
                                      },
                                    })
                                  }
                                />
                                <input
                                  className="input !py-1.5 !text-xs"
                                  placeholder={`${t.cityName} Catalogue`}
                                  value={manualSets[t.cityName.toLowerCase()]?.name ?? ""}
                                  onChange={(e) =>
                                    setManualSets({
                                      ...manualSets,
                                      [t.cityName.toLowerCase()]: {
                                        ...(manualSets[t.cityName.toLowerCase()] ?? { productSetId: "", productCount: 0 }),
                                        name: e.target.value,
                                      },
                                    })
                                  }
                                />
                                <input
                                  className="input !py-1.5 !text-xs"
                                  type="number"
                                  placeholder="Vehicles"
                                  value={manualSets[t.cityName.toLowerCase()]?.productCount || ""}
                                  onChange={(e) =>
                                    setManualSets({
                                      ...manualSets,
                                      [t.cityName.toLowerCase()]: {
                                        ...(manualSets[t.cityName.toLowerCase()] ?? { productSetId: "", name: "" }),
                                        productCount: Number(e.target.value) || 0,
                                      },
                                    })
                                  }
                                />
                              </div>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => setCityNames(cityNames.filter((c) => c !== t.cityName))}
                          className="btn-ghost !px-1.5 !py-1 shrink-0"
                          title="Remove"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Daily budget per city</label>
                {/* Free text, not a stepper. `Number(v) || 0` used to turn a
                    cleared field into a hard 0, which then read as a blocking
                    ₹0/day budget the operator never typed. Empty now simply
                    falls back to the source's own figure. */}
                <input
                  type="text"
                  inputMode="numeric"
                  className="input"
                  value={budgetRaw}
                  placeholder={String(source.dailyBudget)}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d.]/g, "");
                    setBudgetRaw(v);
                    setBudgetOverride(v === "" ? null : Number(v));
                  }}
                />
                <p className="text-xs text-ink-500 mt-1">From the source: {inr(source.dailyBudget)}</p>
              </div>
              <div>
                <label className="label">CPL ceiling</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="input"
                  value={ceilingRaw}
                  placeholder={String(source.targetCpl)}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d.]/g, "");
                    setCeilingRaw(v);
                    setCeilingOverride(v === "" ? null : Number(v));
                  }}
                />
                <p className="text-xs text-ink-500 mt-1">From the source: {inr(source.targetCpl)}</p>
              </div>
            </div>

            {cityNames.length > 1 && (
              <div className="mt-3 rounded-xl border border-ink-200 dark:border-ink-800 p-3.5">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-brand-600"
                    checked={consolidate}
                    onChange={(e) => setConsolidate(e.target.checked)}
                  />
                  <span>
                    <span className="text-sm font-medium text-ink-900 dark:text-ink-50">
                      Put all {cityNames.length} cities in one campaign
                    </span>
                    <span className="block text-xs text-ink-600 dark:text-ink-300 mt-0.5">
                      One campaign, one ad set, one shared budget that Meta moves between the cities — instead of a
                      separate campaign for each.
                    </span>
                  </span>
                </label>

                {consolidate && (
                  <div className="mt-3 pl-7 space-y-3">
                    <div>
                      <label className="label">Name for this group</label>
                      <input
                        className="input max-w-[280px]"
                        value={groupName}
                        placeholder={cityNames.join(" + ")}
                        onChange={(e) => setGroupName(e.target.value)}
                      />
                      <p className="text-xs text-ink-500 mt-1">
                        Campaign name: <span className="font-mono">
                          UC | META | LEAD | {(groupName.trim() || cityNames.join(" + ")).toUpperCase()} | CATALOGUE | LAUNCH
                        </span>
                      </p>
                    </div>

                    {/* Three real consequences. Stated before the launch, not
                        discovered after — each one is irreversible once the ad
                        set exists. */}
                    <div className="rounded-lg border border-caution/40 bg-caution/5 p-3 space-y-1.5">
                      <p className="text-xs text-ink-700 dark:text-ink-200">
                        <span className="font-medium">Per-city reporting stops.</span> Meta reports one spend figure
                        for a shared ad set, so Cities will show this money as unattributed rather than split it by
                        guesswork.
                      </p>
                      <p className="text-xs text-ink-700 dark:text-ink-200">
                        <span className="font-medium">Auto-pause will not touch it.</span> It stops a city by pausing
                        that city&apos;s own ad set, and there is no per-city ad set here. Watch the budget yourself.
                      </p>
                      <p className="text-xs text-ink-700 dark:text-ink-200">
                        <span className="font-medium">Buyers can see other cities&apos; cars.</span> All{" "}
                        {cityNames.length} cities share one product set, so Meta picks from the combined stock.
                      </p>
                      <p className="text-xs text-ink-500">
                        {inr(dailyBudget)}/day for the whole campaign — not per city.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-3">
              <AudienceSelector
                include={audInclude}
                exclude={audExclude}
                onChange={(i, e) => {
                  setAudInclude(i);
                  setAudExclude(e);
                }}
                twinEnabled={twinEnabled}
                twinBudget={twinBudgetRaw}
                onTwinChange={(enabled, budget) => {
                  setTwinEnabled(enabled);
                  setTwinBudgetRaw(budget);
                }}
                broadBudget={dailyBudget}
                cityCount={plan?.launchable.length ?? cityNames.length}
              />
            </div>
          </div>
        )}

        {/* ------------------------------------------------ 2. Review */}
        {step === 2 && plan && source && (
          <div>
            <h2 className="font-bold text-ink-900 dark:text-ink-50 mb-1">Review</h2>
            <p className="text-sm text-ink-500 mb-4">
              {plan.launchable.length} of {plan.targets.length} cities will launch,{" "}
              {inr(plan.totalDailyBudget)}/day in total.
            </p>

            <label className="flex items-start gap-3 p-4 rounded-xl border border-ink-200 dark:border-ink-800 mb-4 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 accent-brand-600"
                checked={pixelVerified}
                onChange={(e) => setPixelVerified(e.target.checked)}
              />
              <span>
                <span className="block font-semibold text-sm text-ink-900 dark:text-ink-50">
                  A test lead was recorded for every city in this batch
                </span>
                <span className="block text-xs text-ink-500 mt-0.5">
                  Replicating multiplies an untracked pixel across every city at once.
                </span>
              </span>
            </label>

            <div className="rounded-xl border border-ink-200 dark:border-ink-800 overflow-hidden">
              {plan.targets.map((t) => (
                <div
                  key={t.cityName}
                  className="p-3.5 border-b border-ink-200 dark:border-ink-800 last:border-0 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-ink-900 dark:text-ink-50">
                      {t.cityName}
                      <span className="ml-2 text-xs font-normal text-ink-500">{t.state}</span>
                    </p>
                    <p className="text-xs text-ink-500 mt-0.5">
                      {source.adSets.length} ad set{source.adSets.length === 1 ? "" : "s"} ·{" "}
                      {t.productSet ? `${t.productSet.name} (${num(t.productSet.productCount)})` : "no product set"}
                    </p>
                    {t.plan.gates
                      .filter((g) => g.status !== "PASS")
                      .map((g) => (
                        <p
                          key={g.id}
                          className={cn("text-xs mt-1", g.status === "BLOCK" ? "text-negative" : "text-caution")}
                        >
                          {g.title}: {g.detail}
                        </p>
                      ))}

                    {/* A city you already run used to be a dead end here, with a
                        button pointing at another screen. It is a legitimate
                        thing to want — a second dealer, a creative test — so it
                        is fixed in place instead: name it, and it launches. */}
                    {t.alreadyExists && (
                      <div className="mt-2.5 pt-2.5 border-t border-ink-200 dark:border-ink-800">
                        <p className="text-xs text-ink-500 mb-1.5">
                          {t.cityName} already has a campaign. Both will target the same geo and bid against each
                          other, so split the budget rather than doubling it. Name this one so they can be told
                          apart:
                        </p>
                        <input
                          className="input max-w-[280px]"
                          placeholder="Dealer or test name, e.g. Big Boy Toyz"
                          value={labels[t.cityName.toLowerCase()] ?? ""}
                          onChange={(e) => setLabels({ ...labels, [t.cityName.toLowerCase()]: e.target.value })}
                        />
                        {labels[t.cityName.toLowerCase()]?.trim() && (
                          <p className="text-[11px] text-ink-500 mt-1.5 font-mono break-all">
                            UC | META | LEAD | {t.cityName.toUpperCase()} | CATALOGUE | LAUNCH |{" "}
                            {labels[t.cityName.toLowerCase()].trim().toUpperCase()}
                          </p>
                        )}
                      </div>
                    )}

                    {/* A blocked city used to be a dead end here: the problem was
                        stated on a screen with no way to fix it. The remedy now
                        sits next to the message. */}
                    {(!t.productSet ||
                      Boolean(manualSets[t.cityName.toLowerCase()]?.productSetId?.trim())) && (
                      <div className="mt-2.5 pt-2.5 border-t border-ink-200 dark:border-ink-800">
                        <p className="text-xs text-ink-500 mb-1.5">
                          {t.productSet
                            ? "Recorded by hand — correct it here if anything is wrong:"
                            : `Create it in the catalogue filtered on ${t.expectedFilterRule}, or record one you already made. Set ID and the vehicle count are what matter; the name is optional.`}
                        </p>
                        <div className="grid grid-cols-3 gap-2 max-w-[440px]">
                          <input
                            className="input !py-1.5 !text-xs"
                            placeholder="Set ID"
                            value={manualSets[t.cityName.toLowerCase()]?.productSetId ?? ""}
                            onChange={(e) =>
                              setManualSets({
                                ...manualSets,
                                [t.cityName.toLowerCase()]: {
                                  ...(manualSets[t.cityName.toLowerCase()] ?? { name: "", productCount: 0 }),
                                  productSetId: e.target.value,
                                },
                              })
                            }
                          />
                          <input
                            className="input !py-1.5 !text-xs"
                            placeholder={`${t.cityName} Catalogue`}
                            value={manualSets[t.cityName.toLowerCase()]?.name ?? ""}
                            onChange={(e) =>
                              setManualSets({
                                ...manualSets,
                                [t.cityName.toLowerCase()]: {
                                  ...(manualSets[t.cityName.toLowerCase()] ?? { productSetId: "", productCount: 0 }),
                                  name: e.target.value,
                                },
                              })
                            }
                          />
                          <input
                            className="input !py-1.5 !text-xs"
                            type="number"
                            placeholder="Vehicles"
                            value={manualSets[t.cityName.toLowerCase()]?.productCount || ""}
                            onChange={(e) =>
                              setManualSets({
                                ...manualSets,
                                [t.cityName.toLowerCase()]: {
                                  ...(manualSets[t.cityName.toLowerCase()] ?? { productSetId: "", name: "" }),
                                  productCount: Number(e.target.value) || 0,
                                },
                              })
                            }
                          />
                        </div>
                        <button
                          className="btn-secondary btn-sm mt-2 !text-xs"
                          disabled={creatingSet === t.cityName}
                          onClick={() => createProductSet(t.cityName)}
                        >
                          {creatingSet === t.cityName ? "Creating…" : "Create it in the catalogue"}
                        </button>
                        {setErrors[t.cityName.toLowerCase()] && (
                          <p className="text-xs text-caution mt-1.5">{setErrors[t.cityName.toLowerCase()]}</p>
                        )}
                      </div>
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-[0.65rem] font-mono uppercase tracking-wide shrink-0 pt-1",
                      t.alreadyExists || !t.plan.canLaunch ? "text-negative" : "text-positive"
                    )}
                  >
                    {t.alreadyExists ? "exists" : t.plan.canLaunch ? "ready" : "blocked"}
                  </span>
                </div>
              ))}
            </div>

            {/* Where the batch goes, decided before the click rather than
                discovered after it. Paused-in-Meta leads because it is the
                only option that is both real and reversible. */}
            <div className="mt-5 rounded-xl border border-ink-200 dark:border-ink-800 p-4">
              <p className="text-sm font-semibold text-ink-900 dark:text-ink-50 mb-2.5">What should happen next?</p>
              <div className="space-y-2">
                {(
                  [
                    {
                      id: "META_PAUSED" as const,
                      title: "Create in Meta, paused",
                      body: "Real campaigns in the ad account, not delivering. Review them in Ads Manager and switch them on yourself.",
                    },
                    {
                      id: "META_ACTIVE" as const,
                      title: "Create in Meta and start spending",
                      body: `Live as soon as review passes — ${inr(dailyBudget)}/day per city, ${inr(
                        dailyBudget * (plan?.launchable.length ?? 0)
                      )}/day across this batch.`,
                    },
                    {
                      id: "PLATFORM" as const,
                      title: "Prepare here only",
                      body: "Writes the plan to this platform and touches nothing in Meta.",
                    },
                  ]
                ).map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setDestination(opt.id)}
                    className={cn(
                      "w-full text-left p-3 rounded-lg border transition-colors",
                      destination === opt.id
                        ? "border-brand-500 bg-brand-50/60"
                        : "border-ink-200 dark:border-ink-800 hover:bg-ink-50 dark:hover:bg-ink-900"
                    )}
                  >
                    <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{opt.title}</p>
                    <p className="text-xs text-ink-600 dark:text-ink-300 mt-0.5">{opt.body}</p>
                  </button>
                ))}
              </div>

              {destination === "META_ACTIVE" && (
                <div className="mt-3">
                  <p className="text-xs text-caution flex items-start gap-1.5 mb-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                    This spends real money. Type <span className="font-semibold">{plan?.launchable.length ?? 0}</span> to
                    confirm.
                  </p>
                  <input
                    className="input max-w-[140px]"
                    value={confirmCount}
                    onChange={(e) => setConfirmCount(e.target.value)}
                    placeholder={String(plan?.launchable.length ?? 0)}
                  />
                </div>
              )}
            </div>

            {error && (
              <p className="mt-4 text-sm text-negative flex items-center gap-1.5">
                <CircleAlert className="h-4 w-4" /> {error}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-4">
        <button
          onClick={() => (step === 0 ? router.push("/campaigns") : setStep(step - 1))}
          className="btn-secondary"
        >
          <ChevronLeft className="h-4 w-4" /> {step === 0 ? "Cancel" : "Back"}
        </button>
        {step < 2 ? (
          <button
            onClick={() => setStep(step + 1)}
            disabled={step === 0 ? !sourceId : cityNames.length === 0}
            className="btn-primary disabled:opacity-40"
          >
            Continue <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={run}
            disabled={
              busy ||
              !plan ||
              plan.launchable.length === 0 ||
              // Spending real money needs the count typed back. A misclick
              // should not be able to start delivery in five cities.
              (destination === "META_ACTIVE" && confirmCount.trim() !== String(plan.launchable.length))
            }
            className="btn-primary disabled:opacity-40"
          >
            {destination === "PLATFORM" ? <Copy className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {busy
              ? destination === "PLATFORM"
                ? "Preparing…"
                : "Creating in Meta…"
              : `${
                  destination === "PLATFORM"
                    ? "Prepare"
                    : destination === "META_PAUSED"
                    ? "Create paused in Meta —"
                    : "Create and start —"
                } ${plan?.launchable.length ?? 0} ${plan?.launchable.length === 1 ? "city" : "cities"}`}
          </button>
        )}
      </div>
    </div>
  );
}
