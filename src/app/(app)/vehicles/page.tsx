"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Car, ExternalLink, ImageOff, RefreshCw, Search } from "lucide-react";
import { useFetch } from "@/lib/useFetch";
import { cn, inr } from "@/lib/format";

/**
 * Vehicles — the cars Meta can actually serve.
 *
 * This page and Inventory used to be two views of the same 4,706 generated
 * rows: one showed placeholder photos, the other showed a per-vehicle spend,
 * CPL, CTR and a 0-100 "score", all invented. Both are now one page reading the
 * catalogue.
 *
 * The performance columns are gone rather than reproduced. Meta can report by
 * product, but this app does not fetch that yet, and a fabricated ₹360 spend
 * against a real Toyota Glanza is worse than no column at all.
 *
 * This page previously rendered 4,706 generated vehicles with picsum.photos
 * placeholder images, a fabricated dealer and an invented "health score". It
 * now reads the catalogue — the only inventory that can appear in an ad. A car
 * CarDekho holds but has not fed to Meta cannot be advertised, however real it
 * is, and a city with nothing here cannot launch at all.
 *
 * What is NOT here is as deliberate as what is. There is no per-vehicle lead
 * count, spend or health score, because Meta does not report those per product
 * and the catalogue does not hold them. Inventing them is how the old page came
 * to exist.
 */

interface Vehicle {
  productId: string;
  retailerId: string;
  name: string;
  url: string | null;
  imageUrl: string | null;
  price: number | null;
  visibility: string | null;
  cityName: string;
  year: number | null;
  kmDriven: number | null;
  colour: string | null;
  make: string | null;
  model: string | null;
  transmission: string | null;
}

interface Payload {
  catalogueId: string;
  catalogueName: string;
  vertical: string;
  cities: { cityName: string; productSetId: string; productCount: number }[];
  vehicles: Vehicle[];
  totalProducts: number;
  truncated: boolean;
  notes: string[];
  error?: string;
}

export default function VehiclesPage() {
  const [city, setCity] = useState("");
  const [search, setSearch] = useState("");
  const { data, loading, error, refetch } = useFetch<Payload>("/api/inventory/live", []);

  const vehicles = useMemo(() => {
    let rows = data?.vehicles ?? [];
    if (city) rows = rows.filter((v) => v.cityName === city);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((v) =>
        [v.name, v.make, v.model].some((s) => s?.toLowerCase().includes(q))
      );
    }
    return rows;
  }, [data?.vehicles, city, search]);

  const totalInCities = (data?.cities ?? []).reduce((s, c) => s + c.productCount, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-900 dark:text-ink-50 flex items-center gap-2">
            <Car className="h-5 w-5" /> Vehicles
          </h1>
          <p className="text-sm text-ink-500 mt-0.5">
            {data && !data.error ? (
              <>
                {totalInCities.toLocaleString("en-IN")} vehicles across {data.cities.length} cities in{" "}
                <span className="font-mono text-xs">{data.catalogueName}</span>{" "}
                <span className="text-ink-400">({data.vertical} catalogue)</span>
              </>
            ) : error ? (
              "Could not read the catalogue"
            ) : (
              "Reading the Meta catalogue…"
            )}
          </p>
          <p className="text-xs text-positive mt-1">
            Live from the Meta catalogue — this is what your ads can actually serve.
          </p>
        </div>
        <button className="btn-secondary" onClick={() => refetch()} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      {(error || data?.error) && (
        <div className="rounded-2xl border border-negative/40 bg-negative/5 p-4">
          <p className="text-sm font-semibold text-negative">Could not read the catalogue</p>
          <p className="text-sm text-ink-700 dark:text-ink-200 mt-1">{error ?? data?.error}</p>
          <p className="text-xs text-ink-500 mt-2">
            Nothing below is missing because the catalogue is empty — the request itself failed.
          </p>
        </div>
      )}

      {/* Per-city counts. This is the number that decides whether a city can
          launch at all, so a zero is drawn as a blocker rather than a footnote. */}
      {data && !data.error && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {data.cities.map((c) => (
            <button
              key={c.productSetId}
              onClick={() => setCity(city === c.cityName ? "" : c.cityName)}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors",
                city === c.cityName
                  ? "border-brand-600 bg-brand-50 dark:bg-brand-950"
                  : "border-ink-200 dark:border-ink-800 hover:bg-ink-50 dark:hover:bg-ink-900"
              )}
            >
              <p className="text-xs text-ink-500">{c.cityName}</p>
              <p
                className={cn(
                  "text-lg font-semibold",
                  c.productCount === 0 ? "text-negative" : "text-ink-900 dark:text-ink-50"
                )}
              >
                {c.productCount.toLocaleString("en-IN")}
              </p>
              {c.productCount === 0 && <p className="text-[11px] text-negative">cannot launch</p>}
            </button>
          ))}
        </div>
      )}

      {data && data.notes?.length > 0 && (
        <div className="rounded-xl border border-caution/40 bg-caution/5 p-3 space-y-1">
          {data.notes.map((n, i) => (
            <p key={i} className="text-xs text-ink-700 dark:text-ink-200 flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-caution shrink-0 mt-0.5" />
              {n}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
          <input
            className="input pl-8 w-64"
            placeholder="Search make or model…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {/* A dropdown as well as the tiles. The tiles are the at-a-glance view
            of which cities can launch; this is how you filter when there are
            more cities than fit in a row. */}
        <select className="input w-44" value={city} onChange={(e) => setCity(e.target.value)}>
          <option value="">All cities</option>
          {(data?.cities ?? []).map((c) => (
            <option key={c.productSetId} value={c.cityName}>
              {c.cityName} ({c.productCount.toLocaleString("en-IN")})
            </option>
          ))}
        </select>
        {city && (
          <button className="btn-secondary btn-sm !text-xs" onClick={() => setCity("")}>
            Clear
          </button>
        )}
        <span className="text-xs text-ink-500">{vehicles.length.toLocaleString("en-IN")} shown</span>
      </div>

      {loading && !data && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card !p-0 overflow-hidden">
              <div className="h-40 bg-ink-100 dark:bg-ink-800 animate-pulse" />
              <div className="p-4 space-y-2">
                <div className="h-4 w-3/4 rounded bg-ink-100 dark:bg-ink-800 animate-pulse" />
                <div className="h-3 w-1/2 rounded bg-ink-100 dark:bg-ink-800 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {vehicles.map((v) => (
          <div key={v.productId} className="card !p-0 overflow-hidden flex flex-col">
            <div className="h-40 bg-ink-100 dark:bg-ink-800 relative">
              {v.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.imageUrl} alt={v.name} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                // A missing image is a fact about the feed worth showing, not a
                // gap to paper over with a stock photo — which is exactly what
                // this page used to do for every single vehicle.
                <div className="h-full w-full flex flex-col items-center justify-center text-ink-400 gap-1">
                  <ImageOff className="h-5 w-5" />
                  <span className="text-[11px]">no image in the catalogue</span>
                </div>
              )}
              <span className="absolute top-2 left-2 text-[11px] px-2 py-0.5 rounded-full bg-white/90 dark:bg-ink-950/90 text-ink-700 dark:text-ink-200">
                {v.cityName}
              </span>
            </div>

            <div className="p-4 flex-1 flex flex-col">
              <p className="font-semibold text-sm text-ink-900 dark:text-ink-50 leading-snug">{v.name}</p>
              <p className="text-xs text-ink-500 mt-0.5">
                {[
                  v.year,
                  v.kmDriven ? `${v.kmDriven.toLocaleString("en-IN")} km` : null,
                  v.colour,
                  v.transmission,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </p>
              <p className="text-sm font-semibold text-ink-900 dark:text-ink-50 mt-2">
                {v.price !== null ? inr(v.price) : "no price in the feed"}
              </p>

              <div className="mt-auto pt-3 flex items-center justify-between">
                <span className="text-[11px] text-ink-400 font-mono">{v.retailerId}</span>
                {v.url && (
                  <a
                    href={v.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1"
                  >
                    View <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {data && !data.error && vehicles.length === 0 && !loading && (
        <p className="text-sm text-ink-500 py-10 text-center">
          Nothing matches.
          {city &&
            ` ${city} has ${(data.cities.find((c) => c.cityName === city)?.productCount ?? 0).toLocaleString("en-IN")} vehicles in the catalogue.`}
        </p>
      )}
    </div>
  );
}
