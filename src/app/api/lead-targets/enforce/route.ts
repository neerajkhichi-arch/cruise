import { NextResponse } from "next/server";
import { requireEditor, requireSession } from "@/lib/api-auth";
import { autoPauseEnabled, enforceLimits, readPauseLog } from "@/lib/meta/enforce";
import { listAllAccounts } from "@/lib/accounts";
import { withAccountCredential } from "@/lib/meta/credentials";

/**
 * The enforcement endpoint.
 *
 * POST runs the check and pauses what qualifies. It exists as an endpoint, not
 * just as an in-process timer, so the same logic can be driven by anything that
 * can make an HTTP request — a cron on a server, a scheduled task — when this
 * eventually needs to run somewhere other than a laptop.
 *
 * GET returns what has been paused and when, because an automated action nobody
 * can look up later is indistinguishable from a bug.
 */

export async function GET() {
  const { error } = await requireSession();
  if (error) return error;
  return NextResponse.json({ enabled: autoPauseEnabled(), log: await readPauseLog(50) });
}

export async function POST(req: Request) {
  // Two ways in: a logged-in editor clicking the button, or a machine holding
  // the shared secret. The secret path exists so a scheduler — the in-process
  // timer today, a real cron later — can drive exactly the same code a person
  // does, rather than a parallel path nobody ever exercises.
  const secret = process.env.AUTO_PAUSE_SECRET?.trim();
  const presented = req.headers.get("x-autopause-secret");
  const byMachine = Boolean(secret && presented && presented === secret);

  if (!byMachine) {
    const { error } = await requireEditor();
    if (error) return error;
  }

  // Every connected account that HAS a sheet, not just the selected one.
  //
  // The scheduler has no browser and therefore no selected account, and an
  // account whose budget is quietly overrunning because nobody happened to be
  // looking at it is precisely what this is for. Accounts with no sheet are
  // skipped and named, so "why did nothing happen for BikeDekho" has an answer.
  const accounts = await listAllAccounts();
  const withSheet = accounts.filter((a) => a.leadTargetsCsvUrl);
  const withoutSheet = accounts.filter((a) => !a.leadTargetsCsvUrl);

  const runs = [];
  for (const account of withSheet) {
    // The credential is set per account, with the callback form rather than
    // enterWith: this loop runs outside any request, so there is no per-request
    // async context to scope it to and each iteration must carry its own.
    runs.push({
      accountId: account.id,
      accountName: account.name,
      ...(await withAccountCredential(account.id, () =>
        enforceLimits(byMachine ? "auto" : "manual", account)
      )),
    });
  }

  return NextResponse.json({
    accounts: runs,
    skippedAccounts: withoutSheet.map((a) => ({
      accountId: a.id,
      accountName: a.name,
      reason: "No lead-target sheet is attached, so there is no target or budget to enforce.",
    })),
    // The single-account shape the existing screen reads, kept so the Lead
    // targets page keeps working while there is one account.
    ...(runs[0] ?? { ran: false, skipped: "No connected account has a lead-target sheet.", paused: [], refused: [] }),
  });
}
