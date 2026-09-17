"use client";

/**
 * Publish a city into the real Meta ad account.
 *
 * The screen is built around one idea: you should be able to read every call
 * before it is made. The preview is not an illustration — it is the same call
 * list the live run executes, rendered rather than sent.
 *
 * Two modes, one code path:
 *   Preview  — always available, sends nothing, needs no credential.
 *   Publish  — needs USE_MOCK_META=false and a token, a typed confirmation,
 *              and a budget under the safety cap.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useFetch } from "@/lib/useFetch";
import { inr, num, cn } from "@/lib/format";
import { AlertTriangle, Check, CircleAlert, Eye, Radio, RotateCcw, Send } from "lucide-react";

interface Source {
  campaignId: string;
  name: string;
  cities: string[];
  dailyBudget: number;
  targetCpl: number;
  cohort: string;
  cpl: number;
  leads: number;
}

interface Ctx {
  live: { enabled: boolean; reasons: string[]; adAccountId: string; adAccountName: string; dailyCap: number };
  sources: Source[];
  existingCityNames: string[];
  knownCities: { name: string; state: string; tier: string }[];
  productSets: { productSetId: string; name: string; productCount: number; cityKey: string | null }[];
  knownGeoKeys: Record<string, string>;
}

interface VerifyCheck {
  id: string;
  label: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail: string;
  remedy?: string;
}

interface Call {
  step: number;
  label: string;
  method: string;
  path: string;
  payload: Record<string, unknown>;
  status: string;
  id?: string;
  error?: string;
  sent: boolean;
}

interface PublishResponse {
  mode: "DRY_RUN" | "LIVE";
  blueprintSource: "META_API" | "RECORDED";
  expectedFilterRule: string;
  source: Record<string, unknown>;
  plan: { notes: string[]; blockers: string[] };
  result: {
    ok: boolean;
    results: Call[];
    created: Record<string, string>;
    error?: string;
    rolledBack: string[];
  };
  error?: string;
  choices?: { key: string; name: string; region: string }[];
}

export default function PublishPage() {
  const { data } = useFetch<Ctx>("/api/publish");
  const params = useSearchParams();

  const [sourceId, setSourceId] = useState("");
  const [cityName, setCityName] = useState("");
  const [productSetId, setProductSetId] = useState("");
  const [productCount, setProductCount] = useState<number | "">("");
  const [dailyBudget, setDailyBudget] = useState(1600);
  const [ceiling, setCeiling] = useState(108);
  const [budgetRaw, setBudgetRaw] = useState("1600");
  const [ceilingRaw, setCeilingRaw] = useState("108");
  const [geoKey, setGeoKey] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<PublishResponse | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; checks: VerifyCheck[] } | null>(null);
  const [verifying, setVerifying] = useState(false);

  /** Ask Meta what this token can actually do, before relying on it. */
  async function runVerify() {
    setVerifying(true);
    try {
      const r = await fetch("/api/meta/verify");
      setVerify((await r.json()) as { ok: boolean; checks: VerifyCheck[] });
    } catch (e) {
      setVerify({
        ok: false,
        checks: [
          { id: "error", label: "Check failed", status: "FAIL", detail: e instanceof Error ? e.message : String(e) },
        ],
      });
    } finally {
      setVerifying(false);
    }
  }

  // Arriving from Replicate carries the city and source across, so the two
  // screens read as one flow rather than as duplicate work.
  useEffect(() => {
    const c = params.get("city");
    const s = params.get("source");
    if (c && !cityName) setCityName(c);
    if (s && !sourceId && data?.sources.some((x) => x.campaignId === s)) setSourceId(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, data]);

  const source = data?.sources.find((s) => s.campaignId === sourceId);
  const known = data?.knownCities.find((c) => c.name.toLowerCase() === cityName.trim().toLowerCase());
  const existing = data?.existingCityNames.some((c) => c.toLowerCase() === cityName.trim().toLowerCase());
  const matchedSet = data?.productSets.find(
    (p) => p.cityKey?.toLowerCase() === cityName.trim().toLowerCase()
  );

  const canPreview = Boolean(sourceId && cityName.trim());
  const canPublish =
    canPreview &&
    Boolean(data?.live.enabled) &&
    confirmation.trim().toLowerCase() === cityName.trim().toLowerCase() &&
    dailyBudget > 0 &&
    dailyBudget <= (data?.live.dailyCap ?? 5000) &&
    Boolean(productSetId || matchedSet);

  async function run(mode: "DRY_RUN" | "LIVE") {
    setBusy(true);
    setRes(null);
    try {
      const r = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          sourceCampaignId: sourceId,
          cityName: cityName.trim(),
          productSetId: productSetId || matchedSet?.productSetId || "",
          productCount: productCount || matchedSet?.productCount || 0,
          dailyBudget,
          cplCeiling: ceiling,
          geoKey: geoKey || undefined,
          confirmation: mode === "LIVE" ? confirmation : undefined,
        }),
      });
      setRes((await r.json()) as PublishResponse);
    } catch (e) {
      setRes({
        mode,
        blueprintSource: "RECORDED",
        expectedFilterRule: "",
        source: {},
        plan: { notes: [], blockers: [] },
        result: { ok: false, results: [], created: {}, rolledBack: [] },
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  const totalMonthly = useMemo(() => dailyBudget * 30, [dailyBudget]);

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink-900 dark:text-ink-50">Publish to Meta</h1>
        <p className="text-sm text-ink-600 dark:text-ink-300 mt-1">
          Preview the exact Graph API calls, then create the campaign for real. The preview and the live
          run share one code path — what you read here is what gets sent.
        </p>
      </div>

      {/* ---- connection state, stated plainly ---- */}
      {data && (
        <div
          className={cn(
            "rounded-xl border p-4 mb-6 flex items-start gap-3",
            data.live.enabled
              ? "border-positive/40 bg-positive/5"
              : "border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900/40"
          )}
        >
          <Radio className={cn("w-4 h-4 mt-0.5 shrink-0", data.live.enabled ? "text-positive" : "text-ink-400")} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">
              {data.live.enabled
                ? `Live — connected to ${data.live.adAccountName} (${data.live.adAccountId})`
                : "Preview only — nothing can reach the ad account"}
            </p>
            {!data.live.enabled && (
              <p className="text-xs text-ink-600 dark:text-ink-300 mt-1">
                {data.live.reasons.join(" ")} Set them in <code className="mono">.env</code> and restart to enable
                publishing. Everything on this page works without them except the final button.
              </p>
            )}
            <p className="text-xs text-ink-500 mt-1">
              Safety cap: {inr(data.live.dailyCap)}/day per city. Raise <code className="mono">META_MAX_DAILY_BUDGET</code>{" "}
              deliberately to go above it.
            </p>
            <button className="btn-secondary btn-sm !text-xs mt-3" onClick={runVerify} disabled={verifying}>
              {verifying ? "Checking…" : "Check credentials"}
            </button>
            {verify && (
              <div className="mt-3 space-y-1.5">
                {verify.checks.map((c) => (
                  <div key={c.id} className="text-xs flex items-start gap-2">
                    <span
                      className={cn(
                        "mono shrink-0 w-10",
                        c.status === "PASS" ? "text-positive" : c.status === "FAIL" ? "text-negative" : "text-ink-400"
                      )}
                    >
                      {c.status}
                    </span>
                    <span className="text-ink-700 dark:text-ink-200">
                      <span className="font-semibold">{c.label}</span> — {c.detail}
                      {c.remedy && <span className="block text-ink-500 mt-0.5">{c.remedy}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        {/* ---- source ---- */}
        <div className="card p-4">
          <label className="label">Copy settings from</label>
          <select className="input" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">Choose a delivering campaign…</option>
            {data?.sources.map((s) => (
              <option key={s.campaignId} value={s.campaignId}>
                {s.name} · {s.cities.join(", ")} · {inr(s.cpl)}/lead
              </option>
            ))}
          </select>
          {source && (
            <div className="mt-3 text-xs text-ink-600 dark:text-ink-300 space-y-1">
              <p>
                <span className="mono">{source.cohort}</span> · {num(source.leads)} leads at {inr(source.cpl)} over 30
                days
              </p>
              <p className="text-ink-500">
                Optimisation goal, promoted object, attribution and every targeting field come from this campaign&apos;s
                live ad set. Only geo, product set and the city in the ad copy are changed.
              </p>
            </div>
          )}
        </div>

        {/* ---- city ---- */}
        <div className="card p-4">
          <label className="label">New city</label>
          <input
            className="input"
            value={cityName}
            onChange={(e) => setCityName(e.target.value)}
            placeholder="Lucknow"
            list="publish-cities"
          />
          <datalist id="publish-cities">
            {data?.knownCities.map((c) => (
              <option key={c.name} value={c.name}>
                {c.state}
              </option>
            ))}
          </datalist>
          <div className="mt-2 text-xs space-y-1">
            {known ? (
              <p className="text-ink-600 dark:text-ink-300">
                {known.state} · {known.tier}
              </p>
            ) : cityName.trim() ? (
              <p className="text-caution">Not in the city list — the state will have to be confirmed.</p>
            ) : null}
            {existing && (
              <p className="text-caution flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                Already in the platform. Publishing again creates a second campaign competing in the same auction.
              </p>
            )}
            {cityName.trim() && !data?.knownGeoKeys[cityName.trim().toLowerCase()] && (
              <p className="text-ink-500">
                Meta targets cities by numeric key. This one is resolved at publish; if the name matches more than one
                Indian city, the publish stops and asks which.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ---- product set ---- */}
      <div className="card p-4 mb-6">
        <label className="label">Product set</label>
        {matchedSet ? (
          <p className="text-sm text-ink-700 dark:text-ink-200">
            {matchedSet.name} · {num(matchedSet.productCount)} vehicles — found in the catalogue for this city.
          </p>
        ) : (
          <>
            <p className="text-xs text-ink-600 dark:text-ink-300 mb-2">
              None exists for {cityName.trim() || "this city"} yet. Create one in Commerce Manager filtered on{" "}
              <code className="mono">{res?.expectedFilterRule || `{"city":{"eq":"${cityName.trim().toLowerCase()}"}}`}</code>
              , then record it here. A catalogue ad has no creative without it.
            </p>
            <div className="grid sm:grid-cols-2 gap-2 max-w-lg">
              <input
                className="input"
                value={productSetId}
                onChange={(e) => setProductSetId(e.target.value)}
                placeholder="Product set ID"
              />
              <input
                className="input"
                type="number"
                value={productCount}
                onChange={(e) => setProductCount(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="Vehicles in the set"
              />
            </div>
          </>
        )}
      </div>

      {/* ---- money ---- */}
      <div className="card p-4 mb-6">
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="label">Daily budget (campaign level)</label>
            {/* Typed entry, no stepper — a scroll wheel over a budget field is
                not a way to change what a campaign spends. */}
            <input
              className="input"
              type="text"
              inputMode="numeric"
              value={budgetRaw}
              placeholder="1600"
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d.]/g, "");
                setBudgetRaw(v);
                setDailyBudget(v === "" ? 0 : Number(v));
              }}
            />
          </div>
          <div>
            <label className="label">CPL ceiling</label>
            <input
              className="input"
              type="text"
              inputMode="numeric"
              value={ceilingRaw}
              placeholder="108"
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d.]/g, "");
                setCeilingRaw(v);
                setCeiling(v === "" ? 0 : Number(v));
              }}
            />
          </div>
          <div>
            <label className="label">Meta city key (optional)</label>
            <input
              className="input"
              value={geoKey}
              onChange={(e) => setGeoKey(e.target.value)}
              placeholder="resolved automatically"
            />
          </div>
        </div>
        <p className="text-xs text-ink-500 mt-2">
          Budget sits on the campaign, not the ad set — the account&apos;s consolidated campaigns are CBO. At{" "}
          {inr(dailyBudget)}/day that is {inr(totalMonthly)} over 30 days
          {data && dailyBudget > data.live.dailyCap ? (
            <span className="text-negative"> — above the {inr(data.live.dailyCap)}/day safety cap.</span>
          ) : (
            "."
          )}
        </p>
      </div>

      {/* ---- actions ---- */}
      <div className="flex flex-wrap items-end gap-3 mb-8">
        <button className="btn-secondary" disabled={!canPreview || busy} onClick={() => run("DRY_RUN")}>
          <Eye className="w-4 h-4" /> {busy ? "Working…" : "Preview the calls"}
        </button>

        <div className="flex-1 min-w-[260px]">
          <label className="label">
            Type <span className="font-semibold">{cityName.trim() || "the city name"}</span> to enable publishing
          </label>
          <input
            className="input"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={cityName.trim() || "city name"}
            disabled={!data?.live.enabled}
          />
        </div>

        <button className="btn-primary" disabled={!canPublish || busy} onClick={() => run("LIVE")}>
          <Send className="w-4 h-4" /> Create in Meta
        </button>
      </div>

      {res && <ResultPanel res={res} />}
    </div>
  );
}

function ResultPanel({ res }: { res: PublishResponse }) {
  if (res.error && res.result.results.length === 0) {
    return (
      <div className="rounded-xl border border-negative/40 bg-negative/5 p-4">
        <p className="text-sm font-semibold text-negative">{res.error}</p>
        {res.choices && (
          <ul className="mt-2 text-xs text-ink-700 dark:text-ink-200 space-y-1">
            {res.choices.map((c) => (
              <li key={c.key}>
                <span className="mono">{c.key}</span> — {c.name}, {c.region}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const live = res.mode === "LIVE";
  return (
    <div className="space-y-4">
      <div
        className={cn(
          "rounded-xl border p-4",
          res.result.ok
            ? live
              ? "border-positive/40 bg-positive/5"
              : "border-ink-200 dark:border-ink-800"
            : "border-negative/40 bg-negative/5"
        )}
      >
        <p className="text-sm font-semibold text-ink-900 dark:text-ink-50 flex items-center gap-2">
          {res.result.ok ? <Check className="w-4 h-4 text-positive" /> : <CircleAlert className="w-4 h-4 text-negative" />}
          {live
            ? res.result.ok
              ? "Created in Meta — these are live and delivering"
              : "Nothing was created"
            : "Preview — nothing was sent"}
        </p>
        <p className="text-xs text-ink-500 mt-1">
          Settings read from {res.blueprintSource === "META_API" ? "the Meta API" : "values recorded off the account"}.
        </p>
        {res.result.error && <p className="text-sm text-negative mt-2">{res.result.error}</p>}
        {res.result.rolledBack.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-semibold text-ink-700 dark:text-ink-200 flex items-center gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" /> Rolled back
            </p>
            <ul className="text-xs text-ink-600 dark:text-ink-300 mt-1 space-y-0.5">
              {res.result.rolledBack.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {Object.keys(res.result.created).length > 0 && (
          <div className="mt-2 text-xs text-ink-700 dark:text-ink-200 space-y-0.5">
            {Object.entries(res.result.created).map(([k, v]) => (
              <p key={k}>
                {k}: <span className="mono">{v}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      {res.plan.blockers.length > 0 && (
        <div className="rounded-xl border border-negative/40 bg-negative/5 p-4">
          <p className="text-sm font-semibold text-negative mb-1">Blocked</p>
          <ul className="text-xs text-ink-700 dark:text-ink-200 space-y-1">
            {res.plan.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {res.plan.notes.length > 0 && (
        <div className="rounded-xl border border-ink-200 dark:border-ink-800 p-4">
          <p className="text-sm font-semibold text-ink-900 dark:text-ink-50 mb-1">What this does</p>
          <ul className="text-xs text-ink-700 dark:text-ink-200 space-y-1.5">
            {res.plan.notes.map((n) => (
              <li key={n}>• {n}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        {res.result.results.map((c) => (
          <div key={c.step} className="rounded-xl border border-ink-200 dark:border-ink-800 overflow-hidden">
            <div className="px-4 py-2.5 bg-ink-50 dark:bg-ink-900/50 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                {c.step}. {c.label}
              </p>
              <span
                className={cn(
                  "text-[10px] mono uppercase tracking-wider px-1.5 py-0.5 rounded",
                  c.status === "OK"
                    ? "text-positive"
                    : c.status === "FAILED"
                    ? "text-negative"
                    : "text-ink-500"
                )}
              >
                {c.sent ? c.status : `${c.status} · not sent`}
                {c.id ? ` · ${c.id}` : ""}
              </span>
            </div>
            <p className="px-4 pt-2 text-xs mono text-ink-600 dark:text-ink-300">
              {c.method} {c.path}
            </p>
            {c.error && <p className="px-4 pt-1 text-xs text-negative">{c.error}</p>}
            <pre className="px-4 pb-3 pt-1 text-[11px] mono text-ink-700 dark:text-ink-200 overflow-x-auto">
              {JSON.stringify(c.payload, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
