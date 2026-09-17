import { NextResponse } from "next/server";
import { requireAccount } from "@/lib/api-auth";
import { GraphError } from "@/lib/meta/graph";
import { getAccountSummary } from "@/lib/meta/account-summary";
import { getLiveCityMetrics } from "@/lib/meta/city-metrics";
import { rangeFromParams } from "@/lib/date-range";

/**
 * The dashboard's numbers, for the range in the URL, read from Meta.
 *
 * Replaces `/api/dashboard/summary`, which read the local `performance_daily`
 * table with the window hardcoded in three different places — 7 days in the
 * tiles, 30 in the chart, and a 30-day query behind a label that said 7.
 *
 * There is deliberately no fallback to the local tables. The old route's
 * silent fallback is how a fortnight-old picture came to sit under a badge
 * reading "Live — real ad account"; an error that says what failed is worth
 * more than a number that cannot be trusted.
 */
export async function GET(req: Request) {
  const { account, error } = await requireAccount(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const range = rangeFromParams(searchParams, "this_month");

  if (process.env.USE_MOCK_META !== "false" || !process.env.META_ACCESS_TOKEN?.trim()) {
    return NextResponse.json(
      { error: "The dashboard reads live Meta data, which needs live mode.", needsLive: true },
      { status: 409 }
    );
  }

  const adAccountId = account.id;

  try {
    // Cities are fetched alongside the totals so the two always describe the
    // same window; the shared cache means the Cities screen costs nothing extra.
    const [summary, cityMetrics] = await Promise.all([
      getAccountSummary(adAccountId, { since: range.since, until: range.until }),
      getLiveCityMetrics(adAccountId, { since: range.since, until: range.until }),
    ]);

    return NextResponse.json({
      ...summary,
      preset: range.preset,
      cities: cityMetrics.cities,
      unattributedSpend: cityMetrics.unattributedSpend,
      notes: [...summary.notes, ...cityMetrics.notes],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof GraphError ? err.describe() : err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
