"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useFetch } from "@/lib/useFetch";
import { CheckCircle2, Circle, Facebook, Instagram, Database, Radio, RefreshCw, Unplug, PlugZap } from "lucide-react";

interface Status {
  connected: boolean;
  businessManager?: string;
  adAccountName?: string;
  pageName?: string;
  igUsername?: string;
  catalogueName?: string;
  pixelId?: string;
  capiEnabled?: boolean;
  connectedAt?: string;
}

interface Assets {
  adAccounts: { id: string; name: string }[];
  pages: { id: string; name: string }[];
  instagramAccounts: { id: string; name: string }[];
  catalogues: { id: string; name: string }[];
  pixels: { id: string; name: string }[];
}

export default function IntegrationsPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user.role === "ADMIN";
  const { data, loading, refetch } = useFetch<{ status: Status; assets: Assets; mode: string }>("/api/integrations/meta");
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selection, setSelection] = useState<Record<string, string>>({});

  async function connect() {
    if (!data) return;
    setConnecting(true);
    const a = data.assets;
    await fetch("/api/integrations/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessManager: "Girnar Motors Retail Group",
        adAccountId: selection.adAccountId ?? a.adAccounts[0]?.id,
        pageId: selection.pageId ?? a.pages[0]?.id,
        igAccountId: selection.igAccountId ?? a.instagramAccounts[0]?.id,
        catalogueId: selection.catalogueId ?? a.catalogues[0]?.id,
        pixelId: selection.pixelId ?? a.pixels[0]?.id,
      }),
    });
    setConnecting(false);
    refetch();
  }

  async function disconnect() {
    await fetch("/api/integrations/meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "disconnect" }) });
    refetch();
  }

  async function sync() {
    setSyncing(true);
    await fetch("/api/integrations/meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync" }) });
    setSyncing(false);
    refetch();
  }

  if (loading || !data) return <div className="h-64 animate-pulse bg-ink-50 rounded-xl" />;
  const { status, assets, mode } = data;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Integrations</h1>
        <p className="text-sm text-ink-500 mt-0.5">Connect Meta Business Manager to sync campaigns, catalogue, and conversions.</p>
      </div>

      {mode === "mock" && (
        <div className="rounded-lg bg-amber-50 text-amber-800 text-sm px-4 py-3">
          Running in <span className="font-medium">mock mode</span> with realistic sample data. Add real Meta API credentials in <code className="text-xs">.env</code> to go live — see README.
        </div>
      )}

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Facebook className="h-5 w-5 text-brand-600" />
            <h2 className="font-semibold text-ink-900">Meta Business Manager</h2>
          </div>
          {status.connected ? (
            <span className="chip chip-positive"><CheckCircle2 className="h-3 w-3" /> Connected</span>
          ) : (
            <span className="chip chip-neutral"><Circle className="h-3 w-3" /> Not connected</span>
          )}
        </div>

        {status.connected ? (
          <div className="space-y-3">
            <ConnectedRow icon={Database} label="Ad Account" value={status.adAccountName} />
            <ConnectedRow icon={Facebook} label="Facebook Page" value={status.pageName} />
            <ConnectedRow icon={Instagram} label="Instagram Account" value={status.igUsername} />
            <ConnectedRow icon={Radio} label="Catalogue" value={status.catalogueName} />
            <ConnectedRow icon={PlugZap} label="Pixel &amp; Conversions API" value={status.pixelId ? `${status.pixelId} · CAPI ${status.capiEnabled ? "enabled" : "disabled"}` : undefined} />

            {isAdmin && (
              <div className="flex gap-2 pt-3">
                <button className="btn-secondary" onClick={sync} disabled={syncing}>
                  <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Syncing…" : "Sync Now"}
                </button>
                <button className="btn-ghost text-negative" onClick={disconnect}>
                  <Unplug className="h-4 w-4" /> Disconnect
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-ink-500">Select the assets to connect (mock OAuth flow):</p>
            <AssetSelect label="Ad Account" options={assets.adAccounts} onChange={(v) => setSelection((s) => ({ ...s, adAccountId: v }))} />
            <AssetSelect label="Facebook Page" options={assets.pages} onChange={(v) => setSelection((s) => ({ ...s, pageId: v }))} />
            <AssetSelect label="Instagram Account" options={assets.instagramAccounts} onChange={(v) => setSelection((s) => ({ ...s, igAccountId: v }))} />
            <AssetSelect label="Catalogue" options={assets.catalogues} onChange={(v) => setSelection((s) => ({ ...s, catalogueId: v }))} />
            <AssetSelect label="Pixel" options={assets.pixels} onChange={(v) => setSelection((s) => ({ ...s, pixelId: v }))} />
            {isAdmin ? (
              <button className="btn-primary" onClick={connect} disabled={connecting}>
                {connecting ? "Connecting…" : "Connect with Meta"}
              </button>
            ) : (
              <p className="text-xs text-ink-400">Only Admins can connect integrations.</p>
            )}
          </div>
        )}
      </div>

      <div className="card p-5">
        <h2 className="font-semibold text-ink-900 mb-1">Inventory &amp; CRM Integrations</h2>
        <p className="text-sm text-ink-500 mb-3">Configure how inventory and lead data flow into Cruise.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-ink-100 p-3">
            <p className="text-sm font-medium text-ink-800">Inventory Feed</p>
            <p className="text-xs text-ink-500 mt-0.5">CSV, Google Sheet, or feed URL — manage in the Inventory page's Import flow.</p>
          </div>
          <div className="rounded-lg border border-ink-100 p-3">
            <p className="text-sm font-medium text-ink-800">CRM</p>
            <p className="text-xs text-ink-500 mt-0.5">Lead stage sync (Valid → Qualified → Sale) is mocked in this demo build.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnectedRow({ icon: Icon, label, value }: { icon: any; label: string; value?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-ink-50/60 px-3.5 py-2.5">
      <Icon className="h-4 w-4 text-ink-400" />
      <div>
        <p className="text-xs text-ink-500">{label}</p>
        <p className="text-sm font-medium text-ink-800">{value ?? "—"}</p>
      </div>
    </div>
  );
}

function AssetSelect({ label, options, onChange }: { label: string; options: { id: string; name: string }[]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <select className="input" onChange={(e) => onChange(e.target.value)} defaultValue={options[0]?.id}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </div>
  );
}
