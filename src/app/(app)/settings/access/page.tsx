"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { useFetch } from "@/lib/useFetch";
import { cn } from "@/lib/format";

/**
 * Who may see which ad account.
 *
 * A grid, because the question people actually ask is "what can Priya see?" and
 * "who can touch the Ahmedabad account?" — and both are answered by looking
 * along a row or down a column. A list of grants answers neither without
 * counting.
 *
 * No access is the default, and it is drawn as a state rather than as an empty
 * cell: a new joiner seeing nothing should look deliberate, because it is.
 */

interface Person {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "VIEWER";
}
interface Account {
  id: string;
  name: string;
  clientName: string | null;
}
interface Grant {
  userId: string;
  accountId: string;
  canEdit: boolean;
}

type Level = "none" | "view" | "edit";

export default function AccessPage() {
  const { data, loading, error, refetch } = useFetch<{
    users: Person[];
    accounts: Account[];
    grants: Grant[];
    error?: string;
  }>("/api/settings/access", []);

  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");

  const levelOf = useMemo(() => {
    const map = new Map<string, Level>();
    for (const g of data?.grants ?? []) map.set(`${g.userId}:${g.accountId}`, g.canEdit ? "edit" : "view");
    return map;
  }, [data?.grants]);

  async function set(userId: string, accountId: string, level: Level) {
    setBusy(`${userId}:${accountId}`);
    setProblem("");
    try {
      const res = await fetch("/api/settings/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, accountId, level }),
      });
      const json = await res.json();
      if (!res.ok) setProblem(json.error ?? "Could not change that.");
      else refetch();
    } catch {
      setProblem("Could not reach the server.");
    }
    setBusy("");
  }

  const people = data?.users ?? [];
  const accounts = data?.accounts ?? [];

  return (
    <div className="max-w-5xl space-y-5">
      <Link href="/settings" className="text-xs text-ink-500 hover:text-brand-600 inline-flex items-center gap-1">
        <ChevronLeft className="h-3.5 w-3.5" /> Back to Settings
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-ink-900 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" /> Account access
        </h1>
        <p className="text-sm text-ink-500 mt-0.5">
          Nobody sees an ad account until they are given it here. Admins are the exception — they see every account by
          role, which is why their rows cannot be edited.
        </p>
      </div>

      {(error || data?.error || problem) && (
        <div className="rounded-2xl border border-negative/40 bg-negative/5 p-4">
          <p className="text-sm text-ink-700">{problem || error || data?.error}</p>
        </div>
      )}

      {loading && !data && <div className="h-40 rounded-xl bg-ink-100 animate-pulse" />}

      {data && accounts.length === 0 && (
        <div className="card p-5">
          <p className="text-sm text-ink-700">
            No ad account is connected yet, so there is nothing to grant.{" "}
            <Link href="/settings/accounts" className="text-brand-700 hover:underline">
              Connect one first.
            </Link>
          </p>
        </div>
      )}

      {data && accounts.length > 0 && (
        <div className="card p-5 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left text-xs font-semibold uppercase tracking-wide text-ink-400 pb-3">Person</th>
                {accounts.map((a) => (
                  <th key={a.id} className="text-left text-xs font-semibold text-ink-700 pb-3 px-3 min-w-[170px]">
                    {a.name}
                    <span className="block font-normal text-[11px] text-ink-400 font-mono">act_{a.id}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className="border-t border-ink-100">
                  <td className="py-3 pr-3 align-top">
                    <span className="block text-sm font-medium text-ink-900">{p.name}</span>
                    <span className="block text-xs text-ink-500">{p.email}</span>
                    <span className="chip chip-neutral !text-[10px] mt-1">{p.role}</span>
                  </td>

                  {accounts.map((a) => {
                    const key = `${p.id}:${a.id}`;
                    const level: Level = p.role === "ADMIN" ? "edit" : levelOf.get(key) ?? "none";
                    const locked = p.role === "ADMIN";
                    return (
                      <td key={a.id} className="py-3 px-3 align-top">
                        {locked ? (
                          <span className="chip chip-positive !text-[10px]">all access (admin)</span>
                        ) : (
                          <div className="inline-flex rounded-lg border border-ink-200 overflow-hidden">
                            {(["none", "view", "edit"] as Level[]).map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                disabled={busy === key || (p.role === "VIEWER" && opt === "edit")}
                                title={
                                  p.role === "VIEWER" && opt === "edit"
                                    ? "This person's role is Viewer, so they cannot edit any account. Change their role first."
                                    : undefined
                                }
                                onClick={() => void set(p.id, a.id, opt)}
                                className={cn(
                                  "px-2.5 py-1 text-xs disabled:opacity-40 disabled:cursor-not-allowed",
                                  level === opt
                                    ? opt === "none"
                                      ? "bg-ink-100 text-ink-700 font-medium"
                                      : "bg-brand-600 text-white font-medium"
                                    : "bg-white text-ink-600 hover:bg-ink-50"
                                )}
                              >
                                {opt === "none" ? "No access" : opt === "view" ? "View" : "Edit"}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <p className="text-xs text-ink-500 mt-4">
            <span className="font-medium">View</span> can read every screen for that account and publish nothing.{" "}
            <span className="font-medium">Edit</span> can create, pause and change budgets in it. A person&apos;s role
            still caps what they can do: a Viewer cannot edit any account, whatever is set here.
          </p>
        </div>
      )}
    </div>
  );
}
