import { NextResponse } from "next/server";
import { requireSession, viewerOf } from "@/lib/api-auth";
import { resolveAccount } from "@/lib/accounts";

/**
 * Is this app talking to the real ad account right now?
 *
 * A separate, deliberately cheap endpoint. The sidebar badge asks on every page
 * load, so it cannot afford /api/publish's metric queries — and the badge is
 * the one place in the product that must never be stale or wrong, because it is
 * what tells an operator whether the next button they press spends money.
 *
 * It reads configuration only. No network call to Meta, so a slow or failing
 * Graph API cannot make a live app look mocked.
 */
export async function GET(req: Request) {
  const { session, error } = await requireSession();
  if (error) return error;

  const reasons: string[] = [];
  if (process.env.USE_MOCK_META !== "false") reasons.push("USE_MOCK_META is not set to false");
  if (!process.env.META_ACCESS_TOKEN?.trim()) reasons.push("META_ACCESS_TOKEN is not set");
  if (!process.env.META_AD_ACCOUNT_ID?.trim()) reasons.push("META_AD_ACCOUNT_ID is not set");

  // The account actually selected, not the one in the environment.
  //
  // This badge named META_AD_ACCOUNT_ID whatever the switcher said, so on any
  // account but CarDekho's the sidebar claimed to be pointed somewhere it was
  // not. For the one element in the product whose job is to say which account
  // the next button spends money in, naming the wrong one is worse than naming
  // none - and it is exactly the sort of detail that makes a reader doubt every
  // other number on the screen, correctly.
  //
  // No Graph call: this still reads configuration and the local account row
  // only, so a slow Meta cannot make a live app look mocked.
  const account = await resolveAccount(req, viewerOf(session)).catch(() => null);

  return NextResponse.json({
    live: reasons.length === 0,
    reasons,
    adAccountId: account?.id ?? process.env.META_AD_ACCOUNT_ID?.trim() ?? null,
    accountName: account?.name ?? null,
  });
}
