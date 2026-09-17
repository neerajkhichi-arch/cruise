"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useFetch } from "@/lib/useFetch";
import { cn } from "@/lib/format";
import Link from "next/link";
import { Building2, Users, Tag, Bell, Loader2, Trash2, UserPlus, Layers, ShieldCheck } from "lucide-react";

const TABS = [
  { id: "account", label: "Account", icon: Building2 },
  { id: "users", label: "Users & Roles", icon: Users },
  { id: "naming", label: "Naming Convention", icon: Tag },
  { id: "notifications", label: "Notifications", icon: Bell },
] as const;

export default function SettingsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("account");
  const { data: session } = useSession();
  const isAdmin = session?.user.role === "ADMIN";

  return (
    <div className="grid lg:grid-cols-[200px_1fr] gap-6">
      <nav className="space-y-1">
        {/* A real route, not an in-page tab: connecting an ad account is a
            different job from editing these fields, and it has its own URL so
            the switcher can link straight to it. Sitting in the same rail keeps
            it findable — as a separate page with no entry point, it was
            effectively invisible. */}
        <Link
          href="/settings/accounts"
          className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-left text-ink-600 hover:bg-ink-50"
        >
          <Layers className="h-4 w-4" /> Ad accounts
        </Link>
        <Link
          href="/settings/access"
          className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-left text-ink-600 hover:bg-ink-50"
        >
          <ShieldCheck className="h-4 w-4" /> Account access
        </Link>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn("w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-left", tab === t.id ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-50")}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </nav>
      <div>
        {tab === "account" && <AccountTab isAdmin={isAdmin} />}
        {tab === "users" && <UsersTab isAdmin={isAdmin} />}
        {tab === "naming" && <NamingTab isAdmin={isAdmin} />}
        {tab === "notifications" && <NotificationsTab isAdmin={isAdmin} />}
      </div>
    </div>
  );
}

function AccountTab({ isAdmin }: { isAdmin: boolean }) {
  const { data, refetch } = useFetch<{ settings: any }>("/api/settings/account");
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.settings && !form) setForm(data.settings);
  }, [data, form]);

  async function save() {
    setSaving(true);
    await fetch("/api/settings/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setSaving(false);
    refetch();
  }

  if (!form) return <div className="h-64 animate-pulse bg-ink-50 rounded-xl" />;

  return (
    <div className="card p-5 max-w-lg space-y-4">
      <h2 className="font-semibold text-ink-900">Account Settings</h2>
      <Field label="Company Name" value={form.companyName} onChange={(v) => setForm({ ...form, companyName: v })} disabled={!isAdmin} />
      <Field label="Default Target CPL (₹)" type="number" value={form.defaultTargetCpl} onChange={(v) => setForm({ ...form, defaultTargetCpl: Number(v) })} disabled={!isAdmin} />
      <Field label="Monthly Budget Cap (₹)" type="number" value={form.monthlyBudgetCap} onChange={(v) => setForm({ ...form, monthlyBudgetCap: Number(v) })} disabled={!isAdmin} />
      <Field label="Low Inventory Threshold (units)" type="number" value={form.lowInventoryThreshold} onChange={(v) => setForm({ ...form, lowInventoryThreshold: Number(v) })} disabled={!isAdmin} />
      <Field label="Old Inventory Threshold (days)" type="number" value={form.oldInventoryDays} onChange={(v) => setForm({ ...form, oldInventoryDays: Number(v) })} disabled={!isAdmin} />
      <Field label="Avg. Deal Margin for ROAS (₹)" type="number" value={form.avgDealMargin} onChange={(v) => setForm({ ...form, avgDealMargin: Number(v) })} disabled={!isAdmin} />
      {isAdmin && (
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
        </button>
      )}
    </div>
  );
}

function NamingTab({ isAdmin }: { isAdmin: boolean }) {
  const { data, refetch } = useFetch<{ naming: any }>("/api/settings/account");
  const [template, setTemplate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.naming?.template && !template) setTemplate(data.naming.template);
  }, [data, template]);

  async function save() {
    setSaving(true);
    await fetch("/api/settings/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ namingTemplate: template }) });
    setSaving(false);
    refetch();
  }

  return (
    <div className="card p-5 max-w-lg space-y-4">
      <h2 className="font-semibold text-ink-900">Campaign Naming Convention</h2>
      <p className="text-sm text-ink-500">Use placeholders <code className="bg-ink-100 rounded px-1">{"{OBJECTIVE}"}</code>, <code className="bg-ink-100 rounded px-1">{"{CITY}"}</code>, and <code className="bg-ink-100 rounded px-1">{"{AUDIENCE}"}</code>.</p>
      <input className="input font-mono text-sm" value={template} onChange={(e) => setTemplate(e.target.value)} disabled={!isAdmin} />
      <p className="text-xs text-ink-400">Preview: {template.replace("{OBJECTIVE}", "LEAD").replace("{CITY}", "AHMEDABAD").replace("{AUDIENCE}", "BROAD")}</p>
      {isAdmin && (
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
        </button>
      )}
    </div>
  );
}

function NotificationsTab({ isAdmin }: { isAdmin: boolean }) {
  const { data, refetch } = useFetch<{ settings: any }>("/api/settings/account");
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.settings && !form) setForm(data.settings);
  }, [data, form]);

  async function save() {
    setSaving(true);
    await fetch("/api/settings/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setSaving(false);
    refetch();
  }

  if (!form) return <div className="h-48 animate-pulse bg-ink-50 rounded-xl" />;

  return (
    <div className="card p-5 max-w-lg space-y-4">
      <h2 className="font-semibold text-ink-900">Alert Notifications</h2>
      <Toggle label="Email" checked={form.emailAlerts} onChange={(v) => setForm({ ...form, emailAlerts: v })} disabled={!isAdmin} />
      <Toggle label="Slack" checked={form.slackAlerts} onChange={(v) => setForm({ ...form, slackAlerts: v })} disabled={!isAdmin} />
      <Toggle label="WhatsApp" checked={form.whatsappAlerts} onChange={(v) => setForm({ ...form, whatsappAlerts: v })} disabled={!isAdmin} />
      {isAdmin && (
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
        </button>
      )}
    </div>
  );
}

function UsersTab({ isAdmin }: { isAdmin: boolean }) {
  const { data, refetch } = useFetch<{ users: any[] }>("/api/settings/users");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("VIEWER");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState("");

  async function invite() {
    setInviting(true);
    setError("");
    const res = await fetch("/api/settings/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, role }) });
    const json = await res.json();
    if (!res.ok) setError(json.error);
    else {
      setName("");
      setEmail("");
      refetch();
    }
    setInviting(false);
  }

  async function changeRole(id: string, newRole: string) {
    await fetch(`/api/settings/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: newRole }) });
    refetch();
  }

  async function remove(id: string) {
    await fetch(`/api/settings/users/${id}`, { method: "DELETE" });
    refetch();
  }

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="card p-5">
          <h2 className="font-semibold text-ink-900 mb-3">Invite User</h2>
          <div className="flex flex-wrap gap-2">
            <input className="input flex-1 min-w-[160px]" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input flex-1 min-w-[200px]" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select className="input w-44" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="VIEWER">Viewer</option>
              <option value="MANAGER">Marketing Manager</option>
              <option value="ADMIN">Admin</option>
            </select>
            <button className="btn-primary" onClick={invite} disabled={inviting || !name || !email}>
              <UserPlus className="h-4 w-4" /> Invite
            </button>
          </div>
          {error && <p className="text-sm text-negative mt-2">{error}</p>}
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full table-clean">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th>{isAdmin && <th className="text-right">Actions</th>}</tr></thead>
          <tbody>
            {(data?.users ?? []).map((u) => (
              <tr key={u.id}>
                <td className="font-medium text-ink-800">{u.name}</td>
                <td className="text-ink-500">{u.email}</td>
                <td>
                  {isAdmin ? (
                    <select className="input !py-1 !text-xs w-40" value={u.role} onChange={(e) => changeRole(u.id, e.target.value)}>
                      <option value="VIEWER">Viewer</option>
                      <option value="MANAGER">Marketing Manager</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  ) : (
                    <span className="chip chip-neutral">{u.role}</span>
                  )}
                </td>
                {isAdmin && (
                  <td className="text-right">
                    <button className="btn-ghost !px-1.5 !py-1 text-negative" onClick={() => remove(u.id)}><Trash2 className="h-3.5 w-3.5" /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", disabled }: { label: string; value: any; onChange: (v: string) => void; type?: string; disabled?: boolean }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-ink-700">{label}</span>
      <button
        onClick={() => !disabled && onChange(!checked)}
        className={cn("h-5 w-9 rounded-full relative transition-colors", checked ? "bg-brand-600" : "bg-ink-200", disabled && "opacity-60 cursor-not-allowed")}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </button>
    </div>
  );
}
