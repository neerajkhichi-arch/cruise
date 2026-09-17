"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Bell, Sparkles, LogOut, ChevronDown } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/format";
import { CopilotDrawer } from "./CopilotDrawer";
import { AccountSwitcher } from "@/components/AccountSwitcher";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  MANAGER: "Marketing Manager",
  VIEWER: "Viewer",
};

export function Topbar({ user }: { user: { name?: string | null; email?: string | null; role: string; avatarColor?: string } }) {
  const [alertCount, setAlertCount] = useState(0);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/api/alerts?unreadOnly=true")
      .then((r) => r.json())
      .then((d) => setAlertCount(d.total ?? 0))
      .catch(() => {});
  }, []);

  return (
    <>
      <header className="h-16 border-b border-ink-100 bg-white/80 backdrop-blur sticky top-0 z-20 flex items-center justify-between px-6">
        <div>
          {/* Rendered on the server and again on the client; without this the two
              can straddle midnight or a locale difference and React throws a
              hydration mismatch. Pre-existing bug, fixed 2026-09-01. */}
          <p className="text-xs text-ink-400" suppressHydrationWarning>{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Which ad account every screen below is showing. Always present,
              including with one account connected — the figures on every page
              belong to a specific ad account and the app should say which. */}
          <AccountSwitcher />
          <button onClick={() => setCopilotOpen(true)} className="btn-secondary">
            <Sparkles className="h-4 w-4 text-brand-600" />
            AI Copilot
          </button>
          <Link href="/recommendations" className="relative btn-ghost !px-2.5" title="Alerts">
            <Bell className="h-5 w-5" />
            {alertCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-red-600 text-white text-[10px] flex items-center justify-center">
                {alertCount}
              </span>
            )}
          </Link>
          <div className="relative">
            <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-2 rounded-lg pl-1 pr-2 py-1 hover:bg-ink-50">
              <div
                className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-semibold"
                style={{ backgroundColor: user.avatarColor ?? "#1a73e8" }}
              >
                {(user.name ?? user.email ?? "U").slice(0, 1).toUpperCase()}
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium text-ink-800 leading-tight">{user.name}</p>
                <p className="text-[11px] text-ink-400 leading-tight">{ROLE_LABEL[user.role]}</p>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-ink-400" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-1 w-48 rounded-lg border border-ink-100 bg-white shadow-card py-1 z-30">
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-ink-700 hover:bg-ink-50"
                >
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <CopilotDrawer open={copilotOpen} onClose={() => setCopilotOpen(false)} />
    </>
  );
}
