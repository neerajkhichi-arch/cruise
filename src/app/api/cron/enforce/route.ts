import { NextResponse } from "next/server";
import { autoPauseEnabled, autoResumeEnabled, enforceLimits } from "@/lib/meta/enforce";
import { listAllAccounts } from "@/lib/accounts";
import { withAccountCredential } from "@/lib/meta/credentials";
import { purgeExpiredCache } from "@/lib/meta/cache";

/**
 * The scheduled auto-pause sweep.
 *
 * A separate route from /api/lead-targets/enforce because Vercel Cron issues a
 * GET and authenticates with `Authorization: Bearer $CRON_SECRET`, while that
 * endpoint takes a POST with a shared header and is the one a person clicks.
 * Wrapping the same logic rather than duplicating it keeps the two honest: the
 * scheduled path and the manual path pause campaigns by exactly the same rules.
 *
 * In-process timers do not survive on serverless — a function instance is
 * frozen the moment it returns a response — so on Vercel this route is the only
 * thing that runs enforcement. If it is not scheduled, auto-pause does not
 * happen, however enabled it looks in the interface.
 *
 * Runs in the Node.js runtime, not the edge: it opens a Postgres connection and
 * signs Graph calls with node crypto.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A sweep across several accounts takes longer than the default allowance. */
export const maxDuration = 300;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim() || process.env.AUTO_PAUSE_SECRET?.trim();
  if (!secret) return false;

  // Vercel Cron's own header, and the one this app already used, so an
  // existing external scheduler keeps working.
  const bearer = req.headers.get("authorization");
  if (bearer === `Bearer ${secret}`) return true;
  return req.headers.get("x-autopause-secret") === secret;
}

export async function GET(req: Request) {
  if (!authorised(req)) {
    // 401 without detail. This endpoint changes live campaigns, and an
    // unauthenticated caller does not get to learn why they were refused.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!autoPauseEnabled()) {
    return NextResponse.json({
      ran: false,
      reason: "Auto-pause is switched off. Set AUTO_PAUSE=true to arm it.",
    });
  }

  const accounts = await listAllAccounts();
  const withSheet = accounts.filter((a) => a.leadTargetsCsvUrl);

  const runs = [];
  for (const account of withSheet) {
    try {
      runs.push({
        accountId: account.id,
        accountName: account.name,
        ...(await withAccountCredential(account.id, () => enforceLimits("auto", account))),
      });
    } catch (err) {
      // One account's failure must not stop the sweep. An account whose token
      // has expired should not protect every other account from enforcement.
      runs.push({
        accountId: account.id,
        accountName: account.name,
        ran: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Housekeeping, here rather than on the hot path: expired cache rows are
  // never served, so deleting them is tidiness, and a delete on a page load is
  // a cost paid by the request that can least afford it.
  const purged = await purgeExpiredCache();

  return NextResponse.json({
    ran: true,
    at: new Date().toISOString(),
    cacheRowsPurged: purged,
    // Stated on every run, so a sweep that resumed nothing can be told apart
    // from a sweep that was never allowed to.
    resumeArmed: autoResumeEnabled(),
    accounts: runs,
    skipped: accounts
      .filter((a) => !a.leadTargetsCsvUrl)
      .map((a) => ({ accountId: a.id, accountName: a.name, reason: "No lead-target sheet attached." })),
  });
}
