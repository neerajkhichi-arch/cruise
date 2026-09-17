/**
 * Arms the auto-pause loop when the server starts.
 *
 * It deliberately imports nothing from the app and calls the HTTP endpoint
 * instead. Two reasons, one practical and one about design:
 *
 *   - Next compiles this file for the edge runtime as well as node, so anything
 *     it imports must work in both. Importing the enforcement logic dragged in
 *     `crypto` and `fs` and broke the build.
 *   - More importantly, it means the timer drives the SAME path an external
 *     scheduler would. When this eventually has to run while the laptop is
 *     closed, pointing a cron at that URL is the whole migration — there is no
 *     second code path that has never been exercised.
 *
 * It only acts while this server runs. That limitation is logged at startup
 * rather than assumed away.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Not on Vercel. A serverless instance is frozen the moment it returns a
  // response, so setInterval here would fire unpredictably or never — and a
  // timer that looks armed in the logs and does nothing is worse than no timer.
  // There, /api/cron/enforce driven by Vercel Cron is the only scheduler.
  if (process.env.VERCEL) {
    console.log(
      "[auto-pause] in-process timer not used on Vercel. Enforcement runs from the cron schedule in vercel.json " +
        "hitting /api/cron/enforce. If that schedule is missing, auto-pause does not run at all."
    );
    return;
  }

  if (process.env.AUTO_PAUSE?.trim() !== "true") {
    console.log("[auto-pause] disabled. Set AUTO_PAUSE=true in .env to arm it.");
    return;
  }

  const secret = process.env.AUTO_PAUSE_SECRET?.trim();
  if (!secret) {
    console.log(
      "[auto-pause] NOT ARMED: AUTO_PAUSE=true but AUTO_PAUSE_SECRET is not set. " +
        "The endpoint refuses unauthenticated callers, so set a secret and restart."
    );
    return;
  }

  const base =
    process.env.AUTO_PAUSE_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    `http://127.0.0.1:${process.env.PORT || 3000}`;
  const url = `${base.replace(/\/$/, "")}/api/lead-targets/enforce`;
  const minutes = Math.max(5, Number(process.env.AUTO_PAUSE_INTERVAL_MINUTES) || 30);

  console.log(
    `[auto-pause] ARMED — ${url} every ${minutes} min while this server runs. ` +
      `Nothing is checked while it is stopped.`
  );

  const run = async () => {
    try {
      const res = await fetch(url, { method: "POST", headers: { "x-autopause-secret": secret } });
      const body = (await res.json()) as {
        skipped?: string | null;
        paused?: { cityName: string; reason: string; paused: string[] }[];
        refused?: { cityName: string; reason: string }[];
      };
      if (!res.ok) {
        console.error(`[auto-pause] endpoint returned ${res.status}`);
        return;
      }
      if (body.skipped) console.log(`[auto-pause] skipped: ${body.skipped}`);
      else if (!body.paused?.length) console.log("[auto-pause] checked, nothing to pause.");
      for (const p of body.paused ?? []) {
        console.log(`[auto-pause] PAUSED ${p.cityName} (${p.reason}) — ${p.paused.length} campaign(s)`);
      }
      for (const r of body.refused ?? []) console.log(`[auto-pause] refused ${r.cityName}: ${r.reason}`);
    } catch (err) {
      console.error("[auto-pause] check failed:", err instanceof Error ? err.message : err);
    }
  };

  // Not immediately: a restart loop would otherwise hammer Meta and trip the
  // per-account rate limit, which also blocks publishing.
  setTimeout(run, 60_000);
  setInterval(run, minutes * 60_000);
}
