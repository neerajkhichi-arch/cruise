"use client";

import { useState } from "react";
import { X, FileSpreadsheet, Globe, Link2, Database, Loader2, CheckCircle2 } from "lucide-react";

const SAMPLE_CSV = `vehicleCode,make,model,variant,year,price,fuel,transmission,kmDriven,dealer,vehicleUrl
UC-DEMO-1,Maruti Suzuki,Swift,VXI,2021,650000,Petrol,Manual,32000,Girnar Certified Cars,https://marketplace.example.com/cars/uc-demo-1
UC-DEMO-2,Hyundai,Creta,SX,2022,1250000,Diesel,Automatic,18000,TrustDrive Motors,https://marketplace.example.com/cars/uc-demo-2`;

const METHODS = [
  { id: "API", label: "API", icon: Database, desc: "Pull live inventory from your DMS or marketplace API." },
  { id: "CSV", label: "CSV Upload", icon: FileSpreadsheet, desc: "Paste or upload a CSV export from your DMS." },
  { id: "SHEET", label: "Google Sheet", icon: Globe, desc: "Sync from a shared Google Sheet." },
  { id: "FEED_URL", label: "Feed URL", icon: Link2, desc: "Point to a hosted XML/JSON inventory feed." },
] as const;

export function ImportInventoryModal({
  open,
  onClose,
  cities,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  cities: { cityId: string; cityName: string }[];
  onImported: () => void;
}) {
  const [method, setMethod] = useState<(typeof METHODS)[number]["id"]>("CSV");
  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [cityId, setCityId] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

  if (!open) return null;

  async function submit() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/inventory/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, csvText: method === "CSV" ? csvText : undefined, cityId: cityId || undefined, url }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      setResult(json);
      onImported();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-950/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 h-14 border-b border-ink-100">
          <h2 className="font-semibold text-ink-900">Import Inventory</h2>
          <button onClick={onClose} className="btn-ghost !px-2"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {METHODS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMethod(m.id)}
                className={`text-left rounded-lg border p-3 transition-colors ${method === m.id ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:bg-ink-50"}`}
              >
                <m.icon className={`h-4 w-4 mb-1.5 ${method === m.id ? "text-brand-600" : "text-ink-400"}`} />
                <p className="text-sm font-medium text-ink-800">{m.label}</p>
                <p className="text-xs text-ink-500 mt-0.5">{m.desc}</p>
              </button>
            ))}
          </div>

          {method === "CSV" && (
            <div>
              <label className="label">CSV data</label>
              <textarea className="input font-mono text-xs h-32" value={csvText} onChange={(e) => setCsvText(e.target.value)} />
              <p className="text-xs text-ink-400 mt-1">Assigns new vehicles to the city selected below.</p>
            </div>
          )}
          {method === "SHEET" && (
            <div>
              <label className="label">Google Sheet URL</label>
              <input className="input" placeholder="https://docs.google.com/spreadsheets/d/…" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
          )}
          {method === "FEED_URL" && (
            <div>
              <label className="label">Feed URL</label>
              <input className="input" placeholder="https://feeds.example.com/inventory.xml" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
          )}
          {method === "API" && (
            <p className="text-sm text-ink-500 bg-ink-50 rounded-lg p-3">
              Connect your DMS/marketplace API under Settings → Inventory Integrations, then trigger a sync here.
            </p>
          )}

          <div>
            <label className="label">Assign to city (optional for CSV)</label>
            <select className="input" value={cityId} onChange={(e) => setCityId(e.target.value)}>
              <option value="">Auto-detect / first city</option>
              {cities.map((c) => (
                <option key={c.cityId} value={c.cityId}>{c.cityName}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-negative">{error}</p>}
          {result && (
            <div className="rounded-lg bg-green-50 text-green-800 p-3 text-sm flex gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">{result.message}</p>
                {result.mode === "simulated" && <p className="text-xs mt-1 opacity-80">Simulated result — no live feed connected yet.</p>}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-ink-100">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={submit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Run Import
          </button>
        </div>
      </div>
    </div>
  );
}
