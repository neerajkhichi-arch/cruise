"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";

/**
 * Sign in.
 *
 * Laid out the way Facebook's own login is: white throughout, the product's
 * claim set large on the left, the form alone on the right, a hairline between
 * them. No gradient panel and no headline statistics — the numbers that used to
 * sit here were invented, and a screen whose job is to let someone in should not
 * be the one place in the app showing figures nobody can trace.
 */

const DEMO_USERS = [
  { email: "admin@autocampaign.ai", role: "Admin", desc: "Full access — integrations, billing, all campaigns" },
  { email: "manager@autocampaign.ai", role: "Marketing Manager", desc: "Create campaigns, set budgets, approve AI recommendations" },
  { email: "viewer@autocampaign.ai", role: "Viewer", desc: "Read-only dashboards and reports" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@autocampaign.ai");
  const [password, setPassword] = useState("demo1234");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDemo, setShowDemo] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError("Invalid email or password.");
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="flex-1 mx-auto w-full max-w-6xl grid lg:grid-cols-2">
        {/* The claim. Big, black, one phrase in blue — the only colour on this
            half of the screen. */}
        <div className="flex flex-col justify-center px-6 pt-14 pb-8 lg:pr-14 lg:py-16">
          <div className="flex items-center gap-2.5 mb-10 lg:mb-16">
            <Sparkles className="h-9 w-9 text-brand-600" />
            <span className="text-2xl font-semibold tracking-tight text-ink-900">Cruise</span>
          </div>
          <h1 className="text-4xl lg:text-[3.25rem] font-bold leading-[1.08] tracking-tight text-ink-900">
            Set the target.
            <br />
            Set the budget.
            <br />
            <span className="text-brand-600">Cruise holds them.</span>
          </h1>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-ink-500">
            Clone a campaign that works into a new city in one step — geo, catalogue and creative resolved for you —
            then let Cruise watch every city against its lead target and its monthly budget, and stop the ones that
            are done.
          </p>
        </div>

        {/* The form. Nothing else. */}
        <div className="flex items-center justify-center px-6 pb-14 lg:py-16 lg:border-l lg:border-ink-100">
          <div className="w-full max-w-sm">
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                className="w-full rounded-xl border border-ink-200 px-4 py-3.5 text-[15px] text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                type="email"
                placeholder="Email address"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <input
                className="w-full rounded-xl border border-ink-200 px-4 py-3.5 text-[15px] text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                type="password"
                placeholder="Password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              {error && <p className="text-sm text-negative pt-1">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full !py-3.5 !text-base font-semibold mt-2"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Sign in
              </button>
            </form>

            <p className="text-center text-sm text-ink-700 mt-4">Forgotten your password? Ask an admin to reset it.</p>

            <div className="border-t border-ink-100 my-6" />

            <div className="flex justify-center">
              <button type="button" className="btn-secondary !py-3 !px-6 font-semibold" onClick={() => setShowDemo((v) => !v)}>
                {showDemo ? "Hide demo accounts" : "Use a demo account"}
              </button>
            </div>

            {showDemo && (
              <div className="mt-5 space-y-1">
                <p className="text-xs text-ink-500 px-1 pb-1">Password for all three is demo1234.</p>
                {DEMO_USERS.map((u) => (
                  <button
                    key={u.email}
                    type="button"
                    onClick={() => {
                      setEmail(u.email);
                      setPassword("demo1234");
                      setShowDemo(false);
                    }}
                    className="w-full text-left rounded-xl px-3 py-2.5 hover:bg-ink-50 transition-colors"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-ink-900">{u.role}</span>
                      <span className="text-xs text-brand-700">{u.email}</span>
                    </span>
                    <span className="block text-xs text-ink-500 mt-0.5">{u.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="border-t border-ink-100">
        <p className="mx-auto max-w-6xl px-6 py-5 text-xs text-ink-400">
          © {new Date().getFullYear()} Cruise · Campaign automation for Meta
        </p>
      </footer>
    </div>
  );
}
