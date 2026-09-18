"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Megaphone,
  MapPin,
  Car,
  Users2,
  Sparkles,
  Lightbulb,
  FileBarChart,
  Plug,
  Settings,
  Send,
  Target,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/format";

/**
 * Whether the app is pointed at the real ad account.
 *
 * This badge used to be the literal string "Mock mode active", hardcoded. It
 * said that while the app was creating campaigns, audiences and creatives in
 * the live CarDekho account — the single most dangerous thing a control panel
 * can get wrong, because it reassures you at exactly the moment you should be
 * paying attention. It now reads the actual configuration.
 *
 * Live is drawn in the warning colour, not the brand colour. Live is the state
 * worth noticing; mock is the safe one.
 */
function MetaModeBadge() {
  const [mode, setMode] = useState<{
    live: boolean;
    reasons: string[];
    adAccountId: string | null;
    accountName?: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/meta/mode")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setMode(d);
      })
      .catch(() => {
        /* leaving it unknown is honest; claiming either state would not be */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!mode) {
    return (
      <div className="rounded-lg bg-ink-100 dark:bg-ink-900 p-3">
        <p className="text-xs font-medium text-ink-500">Meta connection</p>
        <p className="text-sm font-semibold mt-0.5 text-ink-500">Checking…</p>
      </div>
    );
  }

  if (mode.live) {
    return (
      <div className="rounded-lg bg-gradient-to-br from-amber-600 to-amber-800 p-3 text-white">
        <p className="text-xs font-medium opacity-90">Meta connection</p>
        <p className="text-sm font-semibold mt-0.5">Live — real ad account</p>
        {/* Names the SELECTED account, which is what the badge is for. It
            used to print META_AD_ACCOUNT_ID whatever the switcher said. */}
        <p className="text-[11px] opacity-75 mt-1">
          {mode.accountName ? `${mode.accountName} · writes are real` : "Writes are real"}
        </p>
        {mode.adAccountId && <p className="text-[11px] opacity-60 font-mono">act_{mode.adAccountId}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-gradient-to-br from-brand-600 to-brand-800 p-3 text-white">
      <p className="text-xs font-medium opacity-90">Meta connection</p>
      <p className="text-sm font-semibold mt-0.5">Mock mode active</p>
      <p className="text-[11px] opacity-75 mt-1">{mode.reasons[0] ?? "Demo data — see Integrations"}</p>
    </div>
  );
}

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/campaigns/publish", label: "Publish to Meta", icon: Send },
  { href: "/city-campaigns", label: "Bulk cities", icon: Upload },
  { href: "/cities", label: "Cities", icon: MapPin },
  { href: "/vehicles", label: "Vehicles", icon: Car },
  { href: "/leads", label: "Leads", icon: Users2 },
  { href: "/lead-targets", label: "Lead targets", icon: Target },
  { href: "/ai-optimiser", label: "AI Optimiser", icon: Sparkles },
  { href: "/recommendations", label: "Recommendations", icon: Lightbulb },
  { href: "/reports", label: "Reports", icon: FileBarChart },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden lg:flex flex-col w-[248px] shrink-0 border-r border-ink-100 bg-white h-screen sticky top-0">
      <div className="flex items-center px-5 h-16 border-b border-ink-100">
        <span className="font-semibold text-ink-900 tracking-tight">Cruise</span>
      </div>
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
        {NAV.map((item) => {
          // The longest matching href wins, so /campaigns/publish highlights
          // itself rather than lighting up /campaigns as well.
          const best = NAV.filter(
            (n) => pathname === n.href || pathname?.startsWith(n.href + "/")
          ).sort((a, b) => b.href.length - a.href.length)[0];
          const active = best?.href === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900"
              )}
            >
              <Icon className={cn("h-4 w-4", active ? "text-brand-600" : "text-ink-400")} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-ink-100">
        <MetaModeBadge />
      </div>
    </aside>
  );
}
