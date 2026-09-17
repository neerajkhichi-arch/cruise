import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";

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
export async function GET() {
  const { error } = await requireSession();
  if (error) return error;

  const reasons: string[] = [];
  if (process.env.USE_MOCK_META !== "false") reasons.push("USE_MOCK_META is not set to false");
  if (!process.env.META_ACCESS_TOKEN?.trim()) reasons.push("META_ACCESS_TOKEN is not set");
  if (!process.env.META_AD_ACCOUNT_ID?.trim()) reasons.push("META_AD_ACCOUNT_ID is not set");

  return NextResponse.json({
    live: reasons.length === 0,
    reasons,
    adAccountId: process.env.META_AD_ACCOUNT_ID?.trim() ?? null,
  });
}
