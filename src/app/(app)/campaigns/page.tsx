"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useFetch } from "@/lib/useFetch";
import { CplAttention } from "@/components/CplAttention";
import { inr, inrPrecise, num, cn } from "@/lib/format";
import { StatusChip } from "@/components/ui/DeltaChip";
import { CityList } from "@/components/ui/CityList";
import { DateRangePicker, RangeCaption } from "@/components/DateRangePicker";
import { type DateRange, resolvePreset } from "@/lib/date-range";
import { Plus, Pause, Play, Copy, ChevronUp, ChevronDown, Search, Trash2, AlertTriangle } from "lucide-react";

interface CampaignRow {
  campaignId: string;
  name: string;
  status: string;
  cities: string[];
  dailyBudget: number;
  spend: number;
  leads: number;
  cpl: number;
  ctr: number;
  cpc: number;
  cpm: number;
  impressions: number;
  clicks: number;
  reach: number;
  frequency: number;
  targetCpl: number;
  inventoryCount: number;
  resultType: string;
  resultAction?: string | null;
  attributionSetting: string;
  cohort: string;
  stage: string;
}

export default function CampaignsPage() {
  const { data: session } = useSession();
  const canEdit = session?.user.role !== "VIEWER";
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  // Debounced, because the fetch it triggers reads the whole ad account from
  // Meta. Undebounced, typing "chandigarh" fired ten full sweeps and tripped
  // the account's rate limit — which blocks publishing too, not just this page.
  const [searchQuery, setSearchQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(search), 400);
    return () => clearTimeout(t);
  }, [search]);
  // Month-to-date by default, deliberately. Budgets, targets and the P&L are
  // all monthly, so a rolling 30-day window answers a question nobody asks and
  // silently disagrees with every other number in the business — 15 Aug–13 Sept
  // spans two months' budgets. The enforcement and Lead targets already work on
  // the calendar month; this makes the whole app agree.
  const [range, setRange] = useState<DateRange>(() => resolvePreset("this_month"));
  const qs = new URLSearchParams({
    ...(status ? { status } : {}),
    ...(searchQuery ? { search: searchQuery } : {}),
    since: range.since,
    until: range.until,
  }).toString();
  const { data, loading, refetch } = useFetch<{
    campaigns: CampaignRow[];
    source: "META" | "PLATFORM";
    notes: string[];
    sourceError: string | null;
  }>(`/api/campaigns?${qs}`, [
    status,
    searchQuery,
    range.since,
    range.until,
  ]);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function patch(id: string, body: any) {
    setBusyId(id);
    await fetch(`/api/campaigns/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await refetch();
    setBusyId(null);
  }

  /**
   * Deleting is two separate acts — removing our row, and removing the real
   * campaign — so the dialog asks which, rather than picking for you. A
   * campaign that vanishes from this list while still spending is the worst
   * outcome available here.
   */
  const [confirmDelete, setConfirmDelete] = useState<CampaignRow | null>(null);
  const [alsoMeta, setAlsoMeta] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function remove(row: CampaignRow, deleteInMeta: boolean) {
    setBusyId(row.campaignId);
    setDeleteError("");
    const res = await fetch(
      `/api/campaigns/${row.campaignId}?deleteInMeta=${deleteInMeta ? "true" : "false"}`,
      { method: "DELETE" }
    );
    const json = await res.json();
    setBusyId(null);
    if (!res.ok) {
      setDeleteError(json.error ?? "Delete failed.");
      return;
    }
    setConfirmDelete(null);
    setAlsoMeta(false);
    await refetch();
  }

  async function duplicate(id: string) {
    setBusyId(id);
    await fetch(`/api/campaigns/${id}/duplicate`, { method: "POST" });
    await refetch();
    setBusyId(null);
  }

  const campaigns = data?.campaigns ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Campaigns</h1>
          <p className="text-sm text-ink-500 mt-0.5">
            {campaigns.length} campaigns · <RangeCaption range={range} />
          </p>
          {/* Where these numbers came from. The page used to read a local table
              that stopped updating on 1 September while the sidebar said
              "Live" — so the source is now stated rather than assumed. */}
          {data && (
            <p className="text-xs mt-1">
              {data.source === "META" ? (
                <span className="text-positive">Live from Meta · matches Ads Manager for this range</span>
              ) : (
                <span className="text-caution">
                  From this platform&apos;s own records, not Meta — these figures are only as current as the
                  last sync
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* The range sits with the actions rather than the filters: it governs
              every number on the page, where status and search only narrow the
              rows. Outside the canEdit block, since a viewer still has to be
              able to choose the period they are reading. */}
          <DateRangePicker value={range} onChange={setRange} />
          {canEdit && (
            <>
              <Link href="/campaigns/replicate" className="btn-secondary">
                <Copy className="h-4 w-4" /> Replicate
              </Link>
              <Link href="/campaigns/new" className="btn-primary">
                <Plus className="h-4 w-4" /> New Campaign
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Cost per result against each campaign's own three-month history, with
          budget changes taken into account before anything is raised. */}
      <CplAttention />

      {data?.sourceError && (
        <div className="rounded-xl border border-negative/40 bg-negative/5 p-3.5">
          {/* It no longer shows local records - the table below is empty on
              purpose. The old wording outlived the behaviour by one deploy. */}
          <p className="text-sm font-semibold text-negative">Meta could not be read</p>
          <p className="text-xs text-ink-700 dark:text-ink-200 mt-1">{data.sourceError}</p>
          <p className="text-xs text-ink-500 mt-1.5">
            The table below is empty because this account could not be read, not because it has no campaigns. Nothing
            from another account is shown in its place.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
          <input className="input pl-8 w-60" placeholder="Search campaigns…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PAUSED">Paused</option>
          <option value="DRAFT">Draft</option>
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full table-clean min-w-[1500px]">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>City</th>
              <th>Status</th>
              <th>Cohort</th>
              <th className="text-right">Budget</th>
              <th className="text-right">Spend</th>
              <th className="text-right">Impr.</th>
              <th className="text-right">Reach</th>
              <th className="text-right">Freq.</th>
              <th className="text-right">Clicks</th>
              <th className="text-right">CTR</th>
              <th className="text-right">CPC</th>
              <th className="text-right">CPM</th>
              <th className="text-right">Results</th>
              <th className="text-right">Cost / result</th>
              <th className="text-right">Ceiling</th>
              {canEdit && <th className="text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 8 }).map((_, i) => <tr key={i}><td colSpan={17}><div className="h-6 bg-ink-50 animate-pulse rounded" /></td></tr>)}
            {campaigns.map((c) => (
              <tr key={c.campaignId}>
                <td>
                  <Link href={`/campaigns/${c.campaignId}`} className="font-medium text-ink-800 hover:text-brand-600">{c.name}</Link>
                </td>
                <td className="text-ink-500 align-top"><CityList cities={c.cities} /></td>
                <td><StatusChip status={c.status} /></td>
                <td className="text-xs">
                  <span className="font-mono text-ink-600 dark:text-ink-300">{c.resultType}</span>
                  <span className="block font-mono text-ink-400">{c.attributionSetting}</span>
                </td>
                <td className="text-right tabular-nums">{inr(c.dailyBudget, { compact: true })}</td>
                <td className="text-right tabular-nums">{c.spend > 0 ? inr(c.spend, { compact: true }) : <span className="text-ink-400">no delivery</span>}</td>
                <td className="text-right tabular-nums">{c.impressions > 0 ? num(c.impressions) : "—"}</td>
                <td className="text-right tabular-nums">{c.reach > 0 ? num(c.reach) : "—"}</td>
                <td className={cn("text-right tabular-nums", c.frequency >= 5 && "text-red-600 font-semibold")}>
                  {c.frequency > 0 ? c.frequency.toFixed(2) : "—"}
                </td>
                <td className="text-right tabular-nums">{c.clicks > 0 ? num(c.clicks) : "—"}</td>
                <td className="text-right tabular-nums">{c.impressions > 0 ? `${c.ctr.toFixed(2)}%` : "—"}</td>
                <td className="text-right tabular-nums">{c.clicks > 0 ? inrPrecise(c.cpc) : "—"}</td>
                <td className="text-right tabular-nums">{c.impressions > 0 ? inr(c.cpm) : "—"}</td>
                {/* The action counted is on the cell, so a 0 can be checked
                    against Ads Manager rather than merely doubted. */}
                <td className="text-right tabular-nums" title={c.resultAction ? `Counted from ${c.resultAction}` : undefined}>
                  {num(c.leads)}
                </td>
                <td className={cn("text-right tabular-nums", c.leads > 0 && c.cpl > c.targetCpl * 1.2 && "text-red-600")}>{c.leads > 0 ? inr(c.cpl) : "—"}</td>
                <td className="text-right tabular-nums text-ink-500">{c.targetCpl > 0 ? inr(c.targetCpl) : "—"}</td>
                {canEdit && (
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {c.status === "ACTIVE" ? (
                        <button title="Pause" disabled={busyId === c.campaignId} onClick={() => patch(c.campaignId, { action: "pause" })} className="btn-ghost !px-1.5 !py-1"><Pause className="h-3.5 w-3.5" /></button>
                      ) : c.status === "PAUSED" ? (
                        <button title="Resume" disabled={busyId === c.campaignId} onClick={() => patch(c.campaignId, { action: "resume" })} className="btn-ghost !px-1.5 !py-1"><Play className="h-3.5 w-3.5" /></button>
                      ) : null}
                      <button title="Increase budget 10%" disabled={busyId === c.campaignId} onClick={() => patch(c.campaignId, { action: "increase_budget", amount: c.dailyBudget * 0.1 })} className="btn-ghost !px-1.5 !py-1"><ChevronUp className="h-3.5 w-3.5" /></button>
                      <button title="Decrease budget 10%" disabled={busyId === c.campaignId} onClick={() => patch(c.campaignId, { action: "decrease_budget", amount: c.dailyBudget * 0.1 })} className="btn-ghost !px-1.5 !py-1"><ChevronDown className="h-3.5 w-3.5" /></button>
                      <button title="Duplicate" disabled={busyId === c.campaignId} onClick={() => duplicate(c.campaignId)} className="btn-ghost !px-1.5 !py-1"><Copy className="h-3.5 w-3.5" /></button>
                      <button
                        title="Delete"
                        disabled={busyId === c.campaignId}
                        onClick={() => {
                          setConfirmDelete(c);
                          setAlsoMeta(false);
                          setDeleteError("");
                        }}
                        className="btn-ghost !px-1.5 !py-1 text-ink-400 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!loading && campaigns.length === 0 && (
              <tr><td colSpan={13} className="text-center text-ink-400 py-8">No campaigns match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 bg-ink-950/40 flex items-start justify-center p-6 overflow-y-auto"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="card p-5 max-w-lg w-full mt-24"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-semibold text-ink-900 dark:text-ink-50">Delete this campaign?</p>
            <p className="text-sm text-ink-600 dark:text-ink-300 mt-1">{confirmDelete.name}</p>

            {/* A numeric id means it exists in the ad account. A `camp_` id
                means it was only ever prepared here. The dialog says which,
                because the consequence is completely different. */}
            {/^\d{6,}$/.test(confirmDelete.campaignId) ? (
              <>
                <p className="text-xs text-ink-600 dark:text-ink-300 mt-3">
                  This campaign exists in the ad account (<span className="font-mono">{confirmDelete.campaignId}</span>).
                  Removing it here does not remove it there.
                </p>
                <label className="flex items-start gap-2 mt-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-brand-600"
                    checked={alsoMeta}
                    onChange={(e) => setAlsoMeta(e.target.checked)}
                  />
                  <span>
                    <span className="font-semibold text-ink-900 dark:text-ink-50">
                      Delete it in Meta too
                    </span>
                    <span className="block text-xs text-ink-600 dark:text-ink-300 mt-0.5">
                      Removes the campaign and its ad sets and ads from the ad account. Cannot be undone.
                    </span>
                  </span>
                </label>
                {!alsoMeta && (
                  <p className="text-xs text-caution mt-2 flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                    Left unticked, the campaign keeps running in Meta and stops appearing here — pause it in Ads
                    Manager if that is not what you want.
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-ink-600 dark:text-ink-300 mt-3">
                This one was only prepared in the platform — it was never created in Meta, so there is nothing in
                the ad account to clean up.
              </p>
            )}

            {deleteError && <p className="text-sm text-negative mt-3">{deleteError}</p>}

            <div className="flex justify-end gap-2 mt-5">
              <button className="btn-secondary" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button
                className="btn-primary !bg-red-600 hover:!bg-red-700"
                disabled={busyId === confirmDelete.campaignId}
                onClick={() => remove(confirmDelete, alsoMeta)}
              >
                {busyId === confirmDelete.campaignId ? "Deleting…" : alsoMeta ? "Delete here and in Meta" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
