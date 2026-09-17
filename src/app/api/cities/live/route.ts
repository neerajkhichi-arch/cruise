import { NextResponse } from "next/server";
import { requireAccount } from "@/lib/api-auth";
import { GraphError } from "@/lib/meta/graph";
import { getLiveCityMetrics } from "@/lib/meta/city-metrics";
import { rangeFromParams } from "@/lib/date-range";

/**
 * City performance for the range in the URL, read from Meta.
 *
 * Replaces `/api/cities`, which served the seeded local tables — the source of
 * rows reading spend ₹0, leads 0, CPL ₹30, and of three cities this ad account
 * has never targeted.
 */
export async function GET(req: Request) {
  const { account, error } = await requireAccount(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const range = rangeFromParams(searchParams, "this_month");

  if (process.env.USE_MOCK_META !== "false" || !process.env.META_ACCESS_TOKEN?.trim()) {
    return NextResponse.json(
      { error: "City performance reads live Meta data, which needs live mode.", needsLive: true },
      { status: 409 }
    );
  }

  try {
    const out = await getLiveCityMetrics(
      account.id,
      { since: range.since, until: range.until }
    );
    return NextResponse.json({ ...out, preset: range.preset });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof GraphError ? err.describe() : err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
