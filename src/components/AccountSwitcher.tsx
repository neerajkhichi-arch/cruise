"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Building2, Check, ChevronDown, Plus, Settings2 } from "lucide-react";
import { cn } from "@/lib/format";

/**
 * Which ad account every screen is showing.
 *
 * The selected account lives in a cookie rather than in React state, because
 * the server needs it: every Meta read resolves the account per request, and a
 * value held only in the browser would mean the page and the API disagreed
 * about which account they were talking about.
 *
 * It is always on screen, including when only one account is connected. Hiding
 * it then was a mistake: the figures on every page belong to one specific ad
 * account, and a dashboard that never names which one leaves the reader to
 * assume. Naming it costs a line of chrome and removes the assumption.
 *
 * Switching forces a full refresh rather than a soft re-render. Half the
 * screens would otherwise keep showing cached figures from the previous
 * account under the new account's name, which is the single most dangerous
 * thing a multi-account switcher can do.
 */

interface Account {
  id: string;
  name: string;
  businessName: string | null;
  catalogueId: string | null;
  leadTargetsCsvUrl: string | null;
  isDefault: boolean;
}

export function AccountSwitcher() {
  const [connected, setConnected] = useState<Account[]>([]);
  const [selected, setSelected] = useState<Account | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    // connectedOnly keeps this off the Graph API. It mounts on every page.
    fetch("/api/accounts?connectedOnly=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d) {
          setConnected(d.connected ?? []);
          setSelected(d.selected ?? null);
        }
        setLoaded(true);
      })
      .catch(() => {
        // Leaving the name blank is honest; naming an account we could not
        // confirm is not.
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function choose(id: string) {
    if (id === selected?.id) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        // A hard reload, deliberately. Every screen holds its own fetched data
        // and a soft navigation would leave the previous account's numbers on
        // screen under the new account's name.
        window.location.reload();
        return;
      }
    } catch {
      /* fall through to re-enable the control */
    }
    setBusy(false);
  }

  // Nothing at all until the answer is back — a control that flashes "Account"
  // and then changes to a name reads as a glitch.
  if (!loaded) return null;

  if (connected.length === 0) {
    return (
      <Link href="/settings/accounts" className="btn-secondary">
        <Plus className="h-4 w-4" /> Connect an ad account
      </Link>
    );
  }

  const label = selected?.name ?? connected[0]?.name ?? "Account";

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Showing act_${selected?.id ?? connected[0]?.id}`}
      >
        <Building2 className="h-4 w-4 text-ink-400" />
        <span className="max-w-[170px] truncate">{label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-30 mt-1.5 w-[320px] rounded-xl border border-ink-200 bg-white shadow-card p-1.5"
        >
          {connected.map((a) => {
            const active = a.id === (selected?.id ?? connected[0]?.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => void choose(a.id)}
                className={cn("w-full text-left rounded-lg px-2.5 py-2", active ? "bg-brand-50" : "hover:bg-ink-50")}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink-900 truncate">{a.name}</span>
                  {active && <Check className="h-3.5 w-3.5 text-brand-600 shrink-0" />}
                </span>
                <span className="block text-[11px] text-ink-500 font-mono">act_{a.id}</span>
                {/* What this account can and cannot do, so a missing Vehicles
                    tab or a silent auto-pause has an explanation here rather
                    than looking like a fault. */}
                <span className="flex gap-1.5 mt-1">
                  {a.catalogueId ? (
                    <span className="chip chip-neutral !text-[10px]">catalogue</span>
                  ) : (
                    <span className="chip chip-neutral !text-[10px] opacity-60">no catalogue</span>
                  )}
                  {a.leadTargetsCsvUrl ? (
                    <span className="chip chip-positive !text-[10px]">auto-pause on</span>
                  ) : (
                    <span className="chip chip-neutral !text-[10px] opacity-60">no lead targets</span>
                  )}
                </span>
              </button>
            );
          })}

          <Link
            href="/settings/accounts"
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 mt-1 border-t border-ink-100 text-xs text-ink-600 hover:bg-ink-50"
            onClick={() => setOpen(false)}
          >
            <Settings2 className="h-3.5 w-3.5" />
            {connected.length === 1 ? "Connect another account" : "Manage accounts"}
          </Link>
        </div>
      )}
    </div>
  );
}
