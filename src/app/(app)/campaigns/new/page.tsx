"use client";

/**
 * New-city launch wizard.
 *
 * Rebuilt 2026-09-01 against the City Launch Playbook. The previous wizard
 * asked seven questions whose answers changed nothing that mattered: it
 * recommended a "structure" from an invented inventory threshold and took a
 * flat target CPL on trust.
 *
 * This one runs the playbook's gates. A BLOCK stops the launch here and again
 * on the server — the client is not the authority. The ad set constants are
 * shown but not editable, because the whole point of the launch structure is
 * that audience is the only variable.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useFetch } from "@/lib/useFetch";
import { inr, num, cn } from "@/lib/format";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Lock,
  MapPin,
  Sparkles,
} from "lucide-react";
import { cityFilterRule } from "../../../../../scripts/real-catalogue-data";
import { INDIA_CITIES } from "../../../../../scripts/india-cities";
import {
  buildLaunchPlan,
  ceilingLadder,
  CONSTANT_RATIONALE,
  LAUNCH_CONSTANTS,
  learningFloorPerAdSet,
  planAdSets,
  pvAudienceName,
  type Gate,
  type LaunchAdSetKind,
} from "@/lib/engine/launch";
import type { AdSetSettings } from "@/lib/engine/classify";

const STEPS = ["City", "Catalogue", "Ceiling", "Budget", "Ad sets", "Pre-flight", "Review"];

interface LaunchContext {
  cities: {
    cityId: string;
    cityName: string;
    state: string;
    spend: number;
    leads: number;
    dailyBudget: number;
    targetCpl: number;
    inventoryActive: number;
    isNew: boolean;
  }[];
  adSetSettings: AdSetSettings[];
  lookalikeSeedCities: string[];
  catalogues: {
    catalogueId: string;
    name: string;
    vertical: "vehicles" | "commerce";
    inUse: boolean;
    blockedProductSets: { productSetId: string; blockedItems: number }[];
    note?: string;
  }[];
  productSets: {
    productSetId: string;
    catalogueId: string;
    name: string;
    productCount: number;
    filterRule: string;
    cityKey: string | null;
    createdAt: string;
  }[];
  defaultCatalogueId: string;
}

const KIND_LABEL: Record<LaunchAdSetKind, string> = {
  BROAD: "Broad prospecting",
  LOOKALIKE: "Seeded lookalike",
  REMARKETING: "Remarketing",
};

export default function NewCampaignWizard() {
  const router = useRouter();
  const { data } = useFetch<LaunchContext>("/api/launch");
  const ctx = data;

  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"EXISTING" | "NEW">("NEW");
  const [cityId, setCityId] = useState("");
  const [newCityName, setNewCityName] = useState("");
  const [newCityState, setNewCityState] = useState("");
  const [ceiling, setCeiling] = useState<number | null>(null);
  const [ceilingTouched, setCeilingTouched] = useState(false);
  const [dailyBudget, setDailyBudget] = useState(1600);
  const [kinds, setKinds] = useState<LaunchAdSetKind[]>(["BROAD", "LOOKALIKE"]);
  const [catalogueId, setCatalogueId] = useState("");
  const [productSetId, setProductSetId] = useState("");
  // A new city has no product set until someone creates one in Commerce
  // Manager. The app cannot create it (the Meta layer is read-only here), so it
  // takes the id back and records the binding rather than leaving a dead end.
  const [newSet, setNewSet] = useState({ id: "", name: "", count: "" });
  const [pixelVerified, setPixelVerified] = useState(false);
  const [geoAcknowledged, setGeoAcknowledged] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);

  const broadLadder = ceilingLadder("BROAD");
  const selectedCity = ctx?.cities.find((c) => c.cityId === cityId);
  const cityName = mode === "NEW" ? newCityName.trim() : selectedCity?.cityName ?? "";

  // Default the ceiling to the playbook's month-1 figure once a city is named —
  // once only. Re-defaulting on every null would make the field impossible to
  // clear, and the whole point is that an empty ceiling blocks the launch.
  useEffect(() => {
    if (!ceilingTouched && ceiling === null && cityName) setCeiling(broadLadder.month1);
  }, [cityName, ceiling, ceilingTouched, broadLadder.month1]);

  useEffect(() => {
    if (!catalogueId && ctx?.defaultCatalogueId) setCatalogueId(ctx.defaultCatalogueId);
  }, [ctx?.defaultCatalogueId, catalogueId]);

  const catalogue = ctx?.catalogues.find((c) => c.catalogueId === catalogueId) ?? null;
  const catalogueSets = ctx?.productSets.filter((p) => p.catalogueId === catalogueId) ?? [];
  const enteredSet =
    newSet.id.trim() && newSet.name.trim() && cityName
      ? {
          productSetId: newSet.id.trim(),
          catalogueId,
          name: newSet.name.trim(),
          productCount: Number(newSet.count) || 0,
          filterRule: cityFilterRule(cityName),
          cityKey: cityName.toLowerCase(),
          createdAt: new Date().toISOString().slice(0, 10),
        }
      : null;
  const productSet =
    catalogueSets.find((p) => p.productSetId === productSetId) ??
    (productSetId === "__new__" ? enteredSet : null);

  // Offer the set whose filter already matches this city, so the common case is
  // one click and a mismatch is a deliberate act.
  /**
   * Type-ahead for the city field. Cities already in the platform are shown
   * rather than hidden — a name that silently returns nothing reads as "we
   * don't know that city" instead of "you already run it".
   */
  const citySuggestions = useMemo(() => {
    const q = newCityName.trim().toLowerCase();
    if (mode !== "NEW" || !q) return [];
    const running = new Set((ctx?.cities ?? []).map((c) => c.cityName.toLowerCase()));
    const hits = INDIA_CITIES.filter((c) => c.name.toLowerCase().includes(q)).map((c) => ({
      ...c,
      alreadyRunning: running.has(c.name.toLowerCase()),
    }));
    // An exact match needs no list — the state has already been filled in.
    if (hits.length === 1 && hits[0].name.toLowerCase() === q) return [];
    return hits.sort((a, b) => Number(a.alreadyRunning) - Number(b.alreadyRunning)).slice(0, 6);
  }, [newCityName, mode, ctx?.cities]);

  const matchingSet = cityName
    ? catalogueSets.find((p) => p.cityKey?.toLowerCase() === cityName.toLowerCase())
    : undefined;
  useEffect(() => {
    if (!productSetId && matchingSet) setProductSetId(matchingSet.productSetId);
  }, [matchingSet, productSetId]);

  const plan = useMemo(() => {
    if (!ctx || !cityName) return null;
    return buildLaunchPlan({
      cityName,
      cplCeiling: ceiling,
      dailyBudget,
      adSetKinds: kinds,
      pixelVerified,
      catalogue: catalogue
        ? { catalogueId: catalogue.catalogueId, catalogueName: catalogue.name, vertical: catalogue.vertical, inUse: catalogue.inUse }
        : null,
      productSet: productSet
        ? {
            productSetId: productSet.productSetId,
            name: productSet.name,
            productCount: productSet.productCount,
            filterRule: productSet.filterRule,
            cityKey: productSet.cityKey,
          }
        : null,
      existingAdSets: ctx.adSetSettings,
      targetGeo: { cities: [cityName], regions: [] },
    });
  }, [ctx, cityName, ceiling, dailyBudget, kinds, pixelVerified, catalogue, productSet]);

  const planned = useMemo(
    () =>
      cityName
        ? planAdSets(
            cityName,
            kinds,
            dailyBudget,
            ctx?.lookalikeSeedCities ?? [],
            productSet ? { name: productSet.name, productCount: productSet.productCount } : null
          )
        : [],
    [cityName, kinds, dailyBudget, ctx?.lookalikeSeedCities, productSet]
  );

  const floorPerAdSet = ceiling ? learningFloorPerAdSet(ceiling) : 0;
  const floorTotal = floorPerAdSet * Math.max(1, kinds.length);

  function canAdvance(): boolean {
    if (step === 0) return Boolean(cityName) && (mode === "EXISTING" || Boolean(newCityState.trim()));
    // A catalogue ad has no creative of its own — without a product set there is
    // literally nothing to serve, so this step cannot be skipped.
    if (step === 1) return Boolean(catalogue && productSet);
    if (step === 2) return Boolean(ceiling && ceiling > 0);
    if (step === 3) return dailyBudget > 0;
    if (step === 4) return kinds.length > 0;
    return true;
  }

  async function launch() {
    setLaunching(true);
    setError("");
    try {
      const res = await fetch("/api/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cityId: mode === "EXISTING" ? cityId : undefined,
          newCity: mode === "NEW" ? { name: newCityName.trim(), state: newCityState.trim() } : undefined,
          cplCeiling: ceiling,
          dailyBudget,
          adSetKinds: kinds,
          pixelVerified,
          catalogueId,
          productSetId: productSetId === "__new__" ? null : productSetId,
          newProductSet:
            productSetId === "__new__" && enteredSet
              ? {
                  productSetId: enteredSet.productSetId,
                  name: enteredSet.name,
                  productCount: enteredSet.productCount,
                  filterRule: enteredSet.filterRule,
                  cityKey: enteredSet.cityKey,
                }
              : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Launch failed.");
        setLaunching(false);
        return;
      }
      setResult(json);
    } catch {
      setError("Launch failed — could not reach the server.");
    }
    setLaunching(false);
  }

  // ---------------------------------------------------------------- launched
  if (result) {
    return (
      <div className="max-w-3xl">
        <div className="rounded-2xl border border-positive/30 bg-positive/5 p-6 mb-6">
          <div className="flex items-center gap-2 text-positive font-semibold mb-1">
            <Check className="h-5 w-5" /> {result.campaign.cityName} is live
          </div>
          <p className="text-sm text-ink-600 dark:text-ink-300">
            {result.catalogue.name} → {result.productSet.name} · {num(result.productSet.productCount)} vehicles
          </p>
        </div>

        <div className="rounded-xl bg-ink-50 dark:bg-ink-900 border border-ink-200 dark:border-ink-800 p-4 mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-1">Create this audience now</p>
          <p className="font-mono text-sm text-ink-900 dark:text-ink-50 break-all">{result.pvAudience}</p>
          <p className="text-xs text-ink-500 mt-1">
            Empty for weeks — which is why it starts filling today rather than on day 30.
          </p>
        </div>

        <h2 className="font-bold text-ink-900 dark:text-ink-50 mb-3">Ad sets created</h2>
        <div className="rounded-xl border border-ink-200 dark:border-ink-800 overflow-hidden mb-6">
          {result.adSets.map((a: any) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-4 p-4 border-b border-ink-200 dark:border-ink-800 last:border-0"
            >
              <div>
                <p className="font-medium text-ink-900 dark:text-ink-50">{a.name}</p>
                <p className="text-xs text-ink-500">{KIND_LABEL[a.kind as LaunchAdSetKind]}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-mono text-sm text-ink-900 dark:text-ink-50">{inr(a.dailyBudget)}/day</p>
                <p className="text-xs text-ink-500">ceiling {inr(a.ceiling)}</p>
                {a.productSetName && (
                  <p className="text-xs text-ink-500 mt-0.5">
                    {a.productSetName} · {num(a.productCount)} vehicles
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        <h2 className="font-bold text-ink-900 dark:text-ink-50 mb-3">What happens next</h2>
        <ol className="space-y-3 mb-6">
          {[
            ["Day 1–7", result.nextReview.day7],
            ["Day 14", result.nextReview.day14],
            ["Day 30", result.nextReview.day30],
          ].map(([when, what]) => (
            <li key={when as string} className="flex gap-3 text-sm">
              <span className="font-mono text-xs text-brand-600 dark:text-brand-400 shrink-0 pt-0.5 w-16">{when}</span>
              <span className="text-ink-600 dark:text-ink-300">{what}</span>
            </li>
          ))}
        </ol>

        <div className="flex gap-2">
          <button onClick={() => router.push("/campaigns")} className="btn-primary">
            View campaigns <ArrowRight className="h-4 w-4" />
          </button>
          <button onClick={() => router.push("/cities")} className="btn-secondary">
            Open cities
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- wizard
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-extrabold text-ink-900 dark:text-ink-50">Launch a city</h1>
        <p className="text-sm text-ink-500 mt-0.5">
          Runs the City Launch Playbook. Two gates can stop this: a missing CPL ceiling, and a budget below the
          learning-phase floor.
        </p>
      </div>

      <ol className="flex items-center gap-1 mb-6 overflow-x-auto pb-1">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-1 shrink-0">
            <span
              className={cn(
                "text-xs font-semibold px-2.5 py-1 rounded-md whitespace-nowrap",
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
        {/* ---------------------------------------------------- 0. City */}
        {step === 0 && (
          <div>
            <h2 className="font-bold text-ink-900 dark:text-ink-50 mb-1">Which city?</h2>
            <p className="text-sm text-ink-500 mb-4">
              A city enters the platform when it has inventory and a ceiling — not when a campaign is named after it.
            </p>

            <div className="flex gap-2 mb-4">
              {(["NEW", "EXISTING"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "text-sm font-semibold px-3 py-1.5 rounded-lg border",
                    mode === m
                      ? "border-brand-600 bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300"
                      : "border-ink-200 dark:border-ink-800 text-ink-500"
                  )}
                >
                  {m === "NEW" ? "New city" : "City already running"}
                </button>
              ))}
            </div>

            {mode === "NEW" ? (
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="relative">
                  <label className="label">City name</label>
                  <input
                    className="input"
                    value={newCityName}
                    onChange={(e) => {
                      setNewCityName(e.target.value);
                      // Typing a known city fills its state in, the way the
                      // replicate screen does. This wizard was asking for a
                      // state it already knew.
                      const hit = INDIA_CITIES.find(
                        (c) => c.name.toLowerCase() === e.target.value.trim().toLowerCase()
                      );
                      if (hit) setNewCityState(hit.state);
                    }}
                    placeholder="Lucknow"
                    autoComplete="off"
                  />
                  {citySuggestions.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 mt-1 card p-0 overflow-hidden shadow-lg">
                      {citySuggestions.map((c) => (
                        <button
                          key={c.name}
                          onClick={() => {
                            setNewCityName(c.name);
                            setNewCityState(c.state);
                          }}
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
                <div>
                  <label className="label">State</label>
                  <input
                    className="input"
                    value={newCityState}
                    onChange={(e) => setNewCityState(e.target.value)}
                    placeholder="Uttar Pradesh"
                  />
                  {newCityState && (
                    <p className="text-xs text-ink-500 mt-1">
                      {INDIA_CITIES.some((c) => c.name.toLowerCase() === newCityName.trim().toLowerCase())
                        ? "Filled from the city list — change it if this is a different place of the same name."
                        : "Not in the city list, so type the state yourself."}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">
                {ctx?.cities.map((c) => (
                  <button
                    key={c.cityId}
                    onClick={() => setCityId(c.cityId)}
                    className={cn(
                      "text-left p-3 rounded-xl border",
                      cityId === c.cityId
                        ? "border-brand-600 bg-brand-50 dark:bg-brand-950"
                        : "border-ink-200 dark:border-ink-800"
                    )}
                  >
                    <p className="font-semibold text-sm text-ink-900 dark:text-ink-50 flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-ink-400" />
                      {c.cityName}
                    </p>
                    <p className="text-xs text-ink-500 mt-0.5">
                      {c.spend > 0
                        ? `${inr(c.spend, { compact: true })} spent · ${num(c.leads)} results`
                        : "No delivery yet"}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---------------------------------------------------- 1. Catalogue */}
        {step === 1 && (
          <div>
            <h2 className="font-bold text-ink-900 dark:text-ink-50 mb-1">Catalogue and product set</h2>
            <p className="text-sm text-ink-500 mb-4">
              A dynamic catalogue ad has no creative of its own — the product set is the creative. Without both of
              these the ad set cannot be completed in Ads Manager, so this step has no skip.
            </p>

            <label className="label">Catalogue</label>
            <select className="input mb-4" value={catalogueId} onChange={(e) => { setCatalogueId(e.target.value); setProductSetId(""); }}>
              <option value="">Select a catalogue…</option>
              {ctx?.catalogues.map((c) => (
                <option key={c.catalogueId} value={c.catalogueId}>
                  {c.name}
                  {c.inUse ? " — live" : ""} · {c.vertical}
                </option>
              ))}
            </select>

            {catalogue && !catalogue.inUse && (
              <p className="text-xs text-caution mb-4 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {catalogue.note ?? "This is not the catalogue the live campaigns run against."}
              </p>
            )}

            <label className="label">Product set</label>
            {catalogueSets.length === 0 ? (
              <div className="rounded-xl border border-negative/40 bg-negative/5 p-4">
                <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                  This catalogue has no product sets
                </p>
                <p className="text-xs text-ink-500 mt-1">
                  Pick a different catalogue, or create a dynamic set in this one first.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {catalogueSets.map((psx) => {
                  const on = productSetId === psx.productSetId;
                  const matches = psx.cityKey && cityName && psx.cityKey.toLowerCase() === cityName.toLowerCase();
                  return (
                    <button
                      key={psx.productSetId}
                      onClick={() => setProductSetId(psx.productSetId)}
                      className={cn(
                        "w-full text-left p-3.5 rounded-xl border flex items-start justify-between gap-3",
                        on ? "border-brand-600 bg-brand-50 dark:bg-brand-950" : "border-ink-200 dark:border-ink-800"
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold text-sm text-ink-900 dark:text-ink-50">
                          {psx.name}
                          {matches && (
                            <span className="ml-2 text-[0.65rem] font-mono uppercase tracking-wide text-positive">
                              matches city
                            </span>
                          )}
                        </span>
                        <span className="block text-xs font-mono text-ink-500 mt-0.5">
                          {psx.filterRule || "no filter — serves the whole catalogue"}
                        </span>
                      </span>
                      <span className="text-right shrink-0">
                        <span className="block font-mono text-sm text-ink-900 dark:text-ink-50">
                          {num(psx.productCount)}
                        </span>
                        <span className="block text-xs text-ink-500">vehicles</span>
                      </span>
                    </button>
                  );
                })}

                {!matchingSet && cityName && (
                  <div
                    className={cn(
                      "p-3.5 rounded-xl border",
                      productSetId === "__new__"
                        ? "border-brand-600 bg-brand-50 dark:bg-brand-950"
                        : "border-dashed border-ink-300 dark:border-ink-700"
                    )}
                  >
                    <button
                      onClick={() => setProductSetId("__new__")}
                      className="text-left w-full font-semibold text-sm text-ink-900 dark:text-ink-50"
                    >
                      No set for {cityName} yet — record the one you create
                    </button>
                    <p className="text-xs text-ink-500 mt-1">
                      In Commerce Manager, add a dynamic product set to {catalogue?.name ?? "this catalogue"} with the
                      filter <span className="font-mono">{cityFilterRule(cityName)}</span>, then paste its details here.
                      Every existing city is set up this way — Mohali&apos;s was created the day its campaign launched.
                    </p>
                    {productSetId === "__new__" && (
                      <div className="grid sm:grid-cols-3 gap-2 mt-3">
                        <div>
                          <label className="label">Product set ID</label>
                          <input
                            className="input"
                            value={newSet.id}
                            onChange={(e) => setNewSet({ ...newSet, id: e.target.value })}
                            placeholder="1467107688579032"
                          />
                        </div>
                        <div>
                          <label className="label">Name</label>
                          <input
                            className="input"
                            value={newSet.name}
                            onChange={(e) => setNewSet({ ...newSet, name: e.target.value })}
                            placeholder={`${cityName} Catalogue`}
                          />
                        </div>
                        <div>
                          <label className="label">Vehicles</label>
                          <input
                            className="input"
                            type="number"
                            value={newSet.count}
                            onChange={(e) => setNewSet({ ...newSet, count: e.target.value })}
                            placeholder="412"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {plan && <GateList gates={plan.gates.filter((g) => g.id === "catalogue")} />}
          </div>
        )}

        {/* ---------------------------------------------------- 2. Ceiling */}
        {step === 2 && (
          <div>
            <h2 className="font-bold text-ink-900 dark:text-ink-50 mb-1">Write the CPL ceiling</h2>
            <p className="text-sm text-ink-500 mb-4">
              This is the one hard gate. Budget sizing, the day-14 decision and every alert threshold read from this
              number.
            </p>

            <div className="rounded-xl bg-ink-50 dark:bg-ink-900 border border-ink-200 dark:border-ink-800 p-4 mb-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-2">
                Derived from your account · PIXEL_LEAD · 1d_click
              </p>
              <table className="w-full text-sm">
                <tbody>
                  {[
                    ["Cohort benchmark", "₹54", "₹1,69,394 spend / 3,133 results"],
                    ["Prospecting ×1.66", "₹90", "Nashik ₹81 · Chandigarh ₹102"],
                    ["+20% learning premium", `₹${broadLadder.month1}`, "A new ad set has no history"],
                  ].map(([k, v, why]) => (
                    <tr key={k as string} className="border-b border-ink-200 dark:border-ink-800 last:border-0">
                      <td className="py-1.5 text-ink-600 dark:text-ink-300">{k}</td>
                      <td className="py-1.5 font-mono text-right text-ink-900 dark:text-ink-50 pr-3">{v}</td>
                      <td className="py-1.5 text-xs text-ink-400">{why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <label className="label">Month-1 ceiling (₹ per website lead)</label>
            <input
              type="number"
              className="input max-w-[200px]"
              value={ceiling ?? ""}
              onChange={(e) => {
                setCeilingTouched(true);
                setCeiling(e.target.value === "" ? null : Number(e.target.value));
              }}
              step={5}
            />
            <p className="text-xs text-ink-500 mt-2">
              Steps down to {inr(broadLadder.month2to3)} in months 2–3 and {inr(broadLadder.steadyState)} at steady
              state. Chandigarh currently runs at ₹102 — above the steady-state line. That is the ceiling working.
            </p>
          </div>
        )}

        {/* ---------------------------------------------------- 3. Budget */}
        {step === 3 && (
          <div>
            <h2 className="font-bold text-ink-900 dark:text-ink-50 mb-1">Daily budget</h2>
            <p className="text-sm text-ink-500 mb-4">
              Meta needs about 50 conversions per ad set per week to leave the learning phase. Below that, the cost it
              reports is noise you cannot act on.
            </p>

            <div className="grid sm:grid-cols-3 gap-3 mb-4">
              {[
                ["Ceiling", inr(ceiling ?? 0)],
                ["Floor per ad set", inr(floorPerAdSet)],
                [`Floor for ${kinds.length} ad set${kinds.length === 1 ? "" : "s"}`, inr(floorTotal)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-ink-200 dark:border-ink-800 p-3">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-ink-500">{k}</p>
                  <p className="font-mono text-lg font-bold text-ink-900 dark:text-ink-50 mt-0.5">{v}</p>
                </div>
              ))}
            </div>

            <label className="label">Total daily budget (₹)</label>
            <input
              type="number"
              className="input max-w-[220px]"
              value={dailyBudget}
              onChange={(e) => setDailyBudget(Number(e.target.value) || 0)}
              step={100}
            />
            <p className="text-xs text-ink-500 mt-2">
              50 × {inr(ceiling ?? 0)} ÷ 7 = {inr(floorPerAdSet)} per ad set per day.
            </p>

            {plan && <GateList gates={plan.gates.filter((g) => g.id === "floor")} />}
          </div>
        )}

        {/* ---------------------------------------------------- 4. Ad sets */}
        {step === 4 && (
          <div>
            <h2 className="font-bold text-ink-900 dark:text-ink-50 mb-1">Ad sets</h2>
            <p className="text-sm text-ink-500 mb-4">
              A new city has no audience to remarket to, so both launch ad sets are prospecting-class in cost terms.
              Broad and lookalike run in parallel and the data decides at day 14.
            </p>

            <div className="space-y-2 mb-5">
              {(["BROAD", "LOOKALIKE"] as LaunchAdSetKind[]).map((k) => {
                const on = kinds.includes(k);
                const p = planned.find((x) => x.kind === k);
                return (
                  <button
                    key={k}
                    onClick={() => setKinds(on ? kinds.filter((x) => x !== k) : [...kinds, k])}
                    className={cn(
                      "w-full text-left p-4 rounded-xl border flex items-start gap-3",
                      on ? "border-brand-600 bg-brand-50 dark:bg-brand-950" : "border-ink-200 dark:border-ink-800"
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0",
                        on ? "bg-brand-600 border-brand-600" : "border-ink-300"
                      )}
                    >
                      {on && <Check className="h-3 w-3 text-white" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-sm text-ink-900 dark:text-ink-50">{KIND_LABEL[k]}</span>
                      <span className="block text-xs text-ink-500 mt-0.5">
                        {p?.audienceDescription ?? "Seeded from your converting cities."}
                      </span>
                      {on && p && (
                        <span className="block text-xs font-mono text-ink-600 dark:text-ink-300 mt-1">
                          {inr(p.dailyBudget)}/day · ceiling {inr(p.ceiling)}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="rounded-xl border border-ink-200 dark:border-ink-800 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-ink-50 dark:bg-ink-900 border-b border-ink-200 dark:border-ink-800">
                <Lock className="h-3.5 w-3.5 text-ink-400" />
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Held identical across both — audience is the only variable
                </p>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {[
                    ["Age", `${LAUNCH_CONSTANTS.ageMin}–${LAUNCH_CONSTANTS.ageMax}`, CONSTANT_RATIONALE.ageMin],
                    ["Gender", "Men", CONSTANT_RATIONALE.genders],
                    ["Attribution", LAUNCH_CONSTANTS.attributionSetting, CONSTANT_RATIONALE.attributionSetting],
                    ["Optimisation", "UCR_Lead_Submit_New", CONSTANT_RATIONALE.optimizationGoal],
                  ].map(([k, v, why]) => (
                    <tr key={k} className="border-b border-ink-200 dark:border-ink-800 last:border-0">
                      <td className="py-2 px-4 text-ink-600 dark:text-ink-300 w-24">{k}</td>
                      <td className="py-2 font-mono text-xs text-ink-900 dark:text-ink-50 w-32">{v}</td>
                      <td className="py-2 px-4 text-xs text-ink-400">{why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-ink-500 mt-3">
              Nashik&apos;s five live ad sets differ on age floor, gender and attribution at the same time, so no cost
              gap between them has a single explanation. That is what these locks prevent.
            </p>
          </div>
        )}

        {/* ---------------------------------------------------- 5. Pre-flight */}
        {step === 5 && (
          <div>
            <h2 className="font-bold text-ink-900 dark:text-ink-50 mb-1">Pre-flight</h2>
            <p className="text-sm text-ink-500 mb-4">
              Neither of these blocks a launch. Both cost you a month if they are wrong and nothing will tell you.
            </p>

            <label className="flex items-start gap-3 p-4 rounded-xl border border-ink-200 dark:border-ink-800 mb-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 accent-brand-600"
                checked={pixelVerified}
                onChange={(e) => setPixelVerified(e.target.checked)}
              />
              <span>
                <span className="block font-semibold text-sm text-ink-900 dark:text-ink-50">
                  A test lead was recorded for {cityName || "this city"}
                </span>
                <span className="block text-xs text-ink-500 mt-0.5">
                  Submit a live form from the city and confirm UCR_Lead_Submit_New records it. A ceiling you cannot
                  measure is decoration.
                </span>
              </span>
            </label>

            {plan && plan.geoConflicts.length > 0 && (
              <label className="flex items-start gap-3 p-4 rounded-xl border border-caution/40 bg-caution/5 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 accent-brand-600"
                  checked={geoAcknowledged}
                  onChange={(e) => setGeoAcknowledged(e.target.checked)}
                />
                <span>
                  <span className="block font-semibold text-sm text-ink-900 dark:text-ink-50">
                    I have excluded {cityName} from {plan.geoConflicts.length} overlapping ad set
                    {plan.geoConflicts.length === 1 ? "" : "s"}
                  </span>
                  <span className="block text-xs text-ink-500 mt-1">
                    {plan.geoConflicts
                      .map((c) => `${c.adSetName} (${c.theirGeo.join(", ") || "no geo set"})`)
                      .join("; ")}
                  </span>
                  <span className="block text-xs text-ink-500 mt-1">
                    Otherwise they bid against this campaign in the same auction. Chandigarh&apos;s region targeting
                    already contains Mohali for exactly this reason.
                  </span>
                </span>
              </label>
            )}

            {plan && plan.geoConflicts.length === 0 && cityName && (
              <div className="flex items-start gap-3 p-4 rounded-xl border border-ink-200 dark:border-ink-800">
                <Check className="h-4 w-4 text-positive mt-0.5 shrink-0" />
                <p className="text-sm text-ink-600 dark:text-ink-300">
                  No live ad set already targets {cityName} or a region containing it.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ---------------------------------------------------- 6. Review */}
        {step === 6 && plan && (
          <div>
            <h2 className="font-bold text-ink-900 dark:text-ink-50 mb-4">Review</h2>

            <GateList gates={plan.gates} />

            <div className="rounded-xl border border-ink-200 dark:border-ink-800 overflow-hidden mt-5">
              {planned.map((p) => (
                <div
                  key={p.kind}
                  className="p-4 border-b border-ink-200 dark:border-ink-800 last:border-0 flex items-start justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-ink-900 dark:text-ink-50">{p.name}</p>
                    <p className="text-xs text-ink-500 mt-0.5">{p.audienceDescription}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-sm text-ink-900 dark:text-ink-50">{inr(p.dailyBudget)}/day</p>
                    <p className="text-xs text-ink-500">ceiling {inr(p.ceiling)}</p>
                    {p.productSetName && (
                      <p className="text-xs text-ink-500 mt-0.5">
                        {p.productSetName} · {num(p.productCount)} vehicles
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-xl bg-ink-50 dark:bg-ink-900 border border-ink-200 dark:border-ink-800 p-4 mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-1">
                Audience to create alongside
              </p>
              <p className="font-mono text-sm text-ink-900 dark:text-ink-50 break-all">
                {cityName ? pvAudienceName(cityName) : ""}
              </p>
              <p className="text-xs text-ink-500 mt-1">
                Empty for weeks. Remarketing opens around day 30, at ₹64–75 — not Ahmedabad&apos;s ₹32.
              </p>
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
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
          className="btn-secondary disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        {step < STEPS.length - 1 ? (
          <button onClick={() => setStep(step + 1)} disabled={!canAdvance()} className="btn-primary disabled:opacity-40">
            Continue <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={launch}
            disabled={launching || !plan?.canLaunch}
            className="btn-primary disabled:opacity-40"
            title={plan?.canLaunch ? undefined : "A gate is blocking this launch."}
          >
            <Sparkles className="h-4 w-4" /> {launching ? "Launching…" : "Launch city"}
          </button>
        )}
      </div>
    </div>
  );
}

function GateList({ gates }: { gates: Gate[] }) {
  if (gates.length === 0) return null;
  return (
    <div className="space-y-2 mt-4">
      {gates.map((g) => {
        const tone =
          g.status === "BLOCK"
            ? "border-negative/40 bg-negative/5"
            : g.status === "WARN"
            ? "border-caution/40 bg-caution/5"
            : "border-ink-200 dark:border-ink-800";
        const Icon = g.status === "PASS" ? Check : g.status === "WARN" ? AlertTriangle : CircleAlert;
        const iconTone =
          g.status === "BLOCK" ? "text-negative" : g.status === "WARN" ? "text-caution" : "text-positive";
        return (
          <div key={g.id} className={cn("rounded-xl border p-3.5 flex items-start gap-3", tone)}>
            <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", iconTone)} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                {g.title}
                <span className={cn("ml-2 text-[0.65rem] font-mono uppercase tracking-wide", iconTone)}>
                  {g.status}
                </span>
              </p>
              <p className="text-xs text-ink-600 dark:text-ink-300 mt-0.5">{g.detail}</p>
              {g.remedy && <p className="text-xs text-ink-500 mt-1.5">{g.remedy}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
