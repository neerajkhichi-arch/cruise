"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Check, ChevronLeft, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useFetch } from "@/lib/useFetch";
import { cn } from "@/lib/format";

/**
 * Connecting Meta ad accounts.
 *
 * Two lists, because they answer different questions. `Connected` is what
 * Cruise works with. `Available` is what the token can see in Meta — a longer
 * list, and being on it is not the same as being usable: an account also has to
 * be assigned to the system user in Business Settings. Adding one probes it
 * first and says exactly that when the probe fails, rather than accepting it
 * and failing on the first screen that tries to read it.
 *
 * Only the account id is required. A catalogue id and a lead-target sheet are
 * optional and each switches on a capability rather than being setup you must
 * complete: no catalogue means the Vehicles screen does not apply, no sheet
 * means there is nothing for auto-pause to enforce. Both are stated on the row
 * so an absent feature reads as a choice rather than a fault.
 */

interface Connected {
  id: string;
  name: string;
  businessName: string | null;
  catalogueId: string | null;
  conversionEvent: string | null;
  leadTargetsCsvUrl: string | null;
  maxDailyBudget: number | null;
  isDefault: boolean;
}

interface Available {
  id: string;
  name: string;
  businessName: string | null;
  currency: string | null;
  active: boolean;
  connected: boolean;
  canPublish: boolean;
  access: string;
}

/** Conversion actions this account really reported, for the lead-event picker. */
interface LeadEvents {
  since: string;
  until: string;
  current: string | null;
  notes: string[];
  candidates: { actionType: string; label: string; count: number; likelyLead: boolean }[];
}

/** What the token may actually do with a connected account. */
interface Access {
  reachable: boolean;
  canPublish: boolean;
  access: string;
}

export default function AccountsPage() {
  const { data, loading, error, refetch } = useFetch<{
    connected: Connected[];
    selected: Connected | null;
    available: Available[];
    access?: Record<string, Access>;
    error?: string;
  }>("/api/accounts", []);

  const [search, setSearch] = useState("");
  const [manualId, setManualId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Connected>>({});

  // What this account actually reports as a conversion, fetched on demand.
  // Typing the lead event from memory has no error state - a wrong value reads
  // as "no leads this month", which is why this exists.
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<LeadEvents | null>(null);
  const [detectError, setDetectError] = useState("");

  async function detect(accountId: string) {
    setDetecting(true);
    setDetectError("");
    setDetected(null);
    try {
      const res = await fetch(`/api/accounts/lead-events?account=${encodeURIComponent(accountId)}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) setDetectError(json.error ?? "Could not read this account's events.");
      else setDetected(json as LeadEvents);
    } catch {
      setDetectError("Could not reach the server.");
    }
    setDetecting(false);
  }

  const connected = data?.connected ?? [];
  const available = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = (data?.available ?? []).filter((a) => !a.connected);
    if (!q) return rows.slice(0, 12);
    return rows.filter((a) => a.name.toLowerCase().includes(q) || a.id.includes(q)).slice(0, 25);
  }, [data?.available, search]);

  /** Returns whether it saved, so callers can decide what to clear. */
  async function save(body: Record<string, unknown>): Promise<boolean> {
    setBusy(String(body.id));
    setProblem("");
    let ok = false;
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) setProblem(json.error ?? "Could not save.");
      else {
        ok = true;
        setEditing(null);
        refetch();
      }
    } catch {
      setProblem("Could not reach the server.");
    }
    setBusy(null);
    return ok;
  }

  async function remove(id: string, name: string) {
    setBusy(id);
    setProblem("");
    try {
      const res = await fetch(`/api/accounts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) setProblem(json.error ?? `Could not remove ${name}.`);
      else refetch();
    } catch {
      setProblem("Could not reach the server.");
    }
    setBusy(null);
  }

  return (
    <div className="max-w-4xl space-y-5">
      <Link href="/settings" className="text-xs text-ink-500 hover:text-brand-600 inline-flex items-center gap-1">
        <ChevronLeft className="h-3.5 w-3.5" /> Back to Settings
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-ink-900 dark:text-ink-50 flex items-center gap-2">
          <Building2 className="h-5 w-5" /> Ad accounts
        </h1>
        <p className="text-sm text-ink-500 mt-0.5">
          One token covers every account in the same business, so connecting another needs no new credentials — only
          that the account is assigned to your system user in Business Settings.
        </p>
      </div>

      {(error || data?.error) && (
        <div className="rounded-2xl border border-caution/40 bg-caution/5 p-4">
          <p className="text-sm text-ink-700 dark:text-ink-200">{error ?? data?.error}</p>
        </div>
      )}
      {problem && (
        <div className="rounded-2xl border border-negative/40 bg-negative/5 p-4">
          <p className="text-sm text-ink-700 dark:text-ink-200">{problem}</p>
        </div>
      )}

      {/* Connected */}
      <div className="card p-5">
        <h2 className="font-semibold text-ink-900 dark:text-ink-50 mb-3">Connected</h2>
        {loading && !data && <div className="h-16 rounded bg-ink-100 dark:bg-ink-800 animate-pulse" />}

        <div className="space-y-2">
          {connected.map((a) => (
            <div key={a.id} className="rounded-xl border border-ink-200 dark:border-ink-800 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900 dark:text-ink-50">
                    {a.name}
                    {a.isDefault && <span className="chip chip-neutral !text-[10px] ml-2">default</span>}
                    {data?.selected?.id === a.id && (
                      <span className="chip chip-positive !text-[10px] ml-1.5">viewing</span>
                    )}
                  </p>
                  <p className="text-[11px] text-ink-500 font-mono">act_{a.id}</p>
                  {/* What this token may actually DO here. Read access and write
                      access are different grants in Business Settings, and the
                      difference otherwise shows up only when a launch fails. */}
                  {data?.access?.[a.id] && (
                    <p
                      className={cn(
                        "text-xs mt-1 font-medium",
                        data.access[a.id].canPublish ? "text-positive" : "text-caution"
                      )}
                    >
                      {data.access[a.id].canPublish ? "✓ " : "⚠ "}
                      {data.access[a.id].access}
                    </p>
                  )}
                  <p className="text-xs text-ink-500 mt-1">
                    {a.catalogueId ? `Catalogue ${a.catalogueId}` : "No catalogue — Vehicles does not apply"} ·{" "}
                    {a.leadTargetsCsvUrl ? "Lead targets attached" : "No lead targets — auto-pause does not run"}
                  </p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    className="btn-secondary btn-sm !text-xs"
                    onClick={() => {
                      setEditing(editing === a.id ? null : a.id);
                      setDraft(a);
                    }}
                  >
                    {editing === a.id ? "Close" : "Settings"}
                  </button>
                  {!a.isDefault && (
                    <button
                      className="btn-text btn-sm !text-xs"
                      disabled={busy === a.id}
                      onClick={() => void save({ ...a, makeDefault: true })}
                    >
                      Make default
                    </button>
                  )}
                  <button
                    className="btn-ghost btn-sm !text-xs text-negative"
                    disabled={busy === a.id || connected.length <= 1}
                    title={connected.length <= 1 ? "The only connected account" : "Remove from Cruise"}
                    onClick={() => void remove(a.id, a.name)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {editing === a.id && (
                <div className="mt-3 pt-3 border-t border-ink-100 dark:border-ink-800 grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Catalogue ID</label>
                    <input
                      className="input"
                      placeholder="Leave empty for a non-catalogue account"
                      value={draft.catalogueId ?? ""}
                      onChange={(e) => setDraft({ ...draft, catalogueId: e.target.value })}
                    />
                    <p className="text-xs text-ink-500 mt-1">
                      Only for accounts running catalogue ads. Empty hides Vehicles for this account.
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="flex items-end justify-between gap-2">
                      <label className="label">Lead event</label>
                      <button
                        type="button"
                        className="btn-text !text-xs !py-0.5"
                        onClick={() => void detect(a.id)}
                        disabled={detecting}
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5", detecting && "animate-spin")} />
                        {detecting ? "Reading Meta..." : "Show what this account reports"}
                      </button>
                    </div>
                    <input
                      className="input"
                      placeholder="UCR_Lead_Submit_New"
                      value={draft.conversionEvent ?? ""}
                      onChange={(e) => setDraft({ ...draft, conversionEvent: e.target.value })}
                    />
                    <p className="text-xs text-ink-500 mt-1">
                      The pixel event this account fires on a lead. Every lead and CPL figure for this account counts
                      this event and nothing else, so if it is wrong the dashboard shows spend, clicks and impressions
                      normally and zero leads. A bare name is treated as a custom pixel event; a value containing a
                      dot is used exactly as written, which is how lead forms (leadgen.other) and the standard pixel
                      Lead event are set. Empty falls back to the default in .env &mdash; CarDekho&apos;s used-car
                      event, which does not fire on the other accounts.
                    </p>

                    {detectError && <p className="text-xs text-negative mt-2">{detectError}</p>}

                    {detected && (
                      <div className="mt-2 rounded-lg border border-ink-200 p-3">
                        <p className="text-xs text-ink-500">
                          Reported between {detected.since} and {detected.until}. Click one to use it.
                        </p>
                        {detected.notes.map((n, i) => (
                          <p key={i} className="text-xs text-caution mt-1.5 leading-relaxed">
                            {n}
                          </p>
                        ))}
                        <div className="mt-2 space-y-1">
                          {detected.candidates.map((cand) => (
                            <button
                              key={cand.actionType}
                              type="button"
                              onClick={() => setDraft({ ...draft, conversionEvent: cand.actionType })}
                              className="w-full text-left rounded-md px-2 py-1.5 hover:bg-ink-50 flex items-center justify-between gap-3"
                            >
                              <span className="min-w-0">
                                <span className="block text-sm text-ink-800 truncate">{cand.label}</span>
                                <span className="block text-[11px] text-ink-400 font-mono truncate">
                                  {cand.actionType}
                                </span>
                              </span>
                              <span className="shrink-0 flex items-center gap-2">
                                {cand.likelyLead && <span className="chip chip-positive !text-[10px]">likely lead</span>}
                                <span className="text-xs text-ink-500 tabular-nums">{cand.count.toLocaleString()}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label">Lead targets sheet (published CSV)</label>
                    <input
                      className="input"
                      placeholder="Leave empty if this account has no monthly targets"
                      value={draft.leadTargetsCsvUrl ?? ""}
                      onChange={(e) => setDraft({ ...draft, leadTargetsCsvUrl: e.target.value })}
                    />
                    <p className="text-xs text-ink-500 mt-1">
                      Auto-pause only runs for accounts with a sheet. Without one there is no target or budget to
                      enforce, so it is skipped rather than appearing to be on.
                    </p>
                  </div>
                  <div>
                    <label className="label">Daily budget cap per campaign</label>
                    <input
                      className="input"
                      inputMode="numeric"
                      placeholder="Uses META_MAX_DAILY_BUDGET"
                      value={draft.maxDailyBudget ?? ""}
                      onChange={(e) =>
                        setDraft({ ...draft, maxDailyBudget: Number(e.target.value.replace(/[^\d]/g, "")) || null })
                      }
                    />
                  </div>
                  <div className="sm:col-span-2 flex gap-2">
                    <button
                      className="btn-primary btn-sm"
                      disabled={busy === a.id}
                      onClick={() => void save({ ...draft, id: a.id, name: a.name })}
                    >
                      <Check className="h-3.5 w-3.5" /> Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Available */}
      <div className="card p-5">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="font-semibold text-ink-900 dark:text-ink-50">Add another</h2>
          <button className="btn-secondary btn-sm !text-xs" onClick={() => refetch()} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </button>
        </div>
        <p className="text-xs text-ink-500 mb-3">
          Read from Meta. Adding one checks the token can actually reach it — if it cannot, the account still needs
          assigning to your system user in Business Settings, and the message will say so.
        </p>

        <input
          className="input mb-3"
          placeholder="Search your ad accounts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
          {available.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 dark:border-ink-800 p-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm text-ink-900 dark:text-ink-50 truncate">
                  {a.name}
                  {!a.active && <span className="chip chip-caution !text-[10px] ml-2">not active</span>}
                </p>
                <p className="text-[11px] text-ink-500 font-mono">
                  act_{a.id}
                  {a.businessName && <span className="font-sans"> · {a.businessName}</span>}
                </p>
                <p className={cn("text-[11px]", a.canPublish ? "text-ink-500" : "text-caution")}>{a.access}</p>
              </div>
              <button
                className="btn-secondary btn-sm !text-xs shrink-0"
                disabled={busy === a.id}
                onClick={() => void save({ id: a.id, name: a.name, businessName: a.businessName })}
              >
                <Plus className="h-3.5 w-3.5" /> {busy === a.id ? "Checking…" : "Add"}
              </button>
            </div>
          ))}
          {available.length === 0 && (
            <p className="text-sm text-ink-500 py-3">
              {search ? `No account matches “${search}”.` : "Every account this token can see is already connected."}
            </p>
          )}
        </div>

        {/* Adding by id, for the account that is not on the list.
            The list above is what the TOKEN can see, which is only the accounts
            assigned to its system user. An account in another Business Manager,
            or one nobody has assigned yet, will never appear there however many
            times the list is refreshed — so there has to be a way to name one
            directly. It is probed exactly like a listed account, and the
            refusal says what to fix. */}
        <div className="mt-4 pt-4 border-t border-ink-100">
          <label className="label">Not listed? Add by ad account ID</label>
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="10153410655459601 — or act_10153410655459601"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
            />
            <button
              className="btn-primary btn-sm shrink-0"
              disabled={!manualId.trim() || busy === manualId.replace(/^act_/, "").trim()}
              onClick={() => {
                const id = manualId.replace(/^act_/, "").trim();
                // Kept in the field on failure — clearing it would make the
                // operator retype an id to read the error against.
                void save({ id }).then((ok) => ok && setManualId(""));
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>
          <p className="text-xs text-ink-500 mt-1.5">
            Cruise reads the account before saving it. If the token cannot reach it, nothing is stored and the message
            names the fix — almost always assigning it to your system user in Business Settings.
          </p>
        </div>
      </div>

      {/* How to get an account onto the list above. Written out because the
          failure people hit is not in this app at all: the list is empty, they
          refresh it, and nothing changes, because the missing step is on
          Meta's side. */}
      <div className="card p-5">
        <h2 className="font-semibold text-ink-900 mb-2">Adding an account that is not listed</h2>
        <ol className="text-sm text-ink-700 space-y-2 list-decimal pl-5">
          <li>
            Open <span className="font-medium">business.facebook.com</span> → Settings → Users →{" "}
            <span className="font-medium">System users</span>, in the business that owns the ad account.
          </li>
          <li>
            Select the system user whose token Cruise is using, then{" "}
            <span className="font-medium">Add assets</span> → <span className="font-medium">Ad accounts</span>.
          </li>
          <li>
            Tick the account and give it <span className="font-medium">Manage campaigns</span> — view-only is enough
            for reporting but will refuse every publish and every pause.
          </li>
          <li>Come back here, press Refresh, and the account appears under “Add another”.</li>
        </ol>
        <p className="text-xs text-ink-500 mt-3">
          One token covers every account <em>in the same business</em>. An account owned by a different Business
          Manager cannot be reached this way — that business has to grant partner access to yours, or it needs its own
          system user and token, which is a separate setup rather than another row here.
        </p>
      </div>
    </div>
  );
}
