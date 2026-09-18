import { NextResponse } from "next/server";
import { requireAccount } from "@/lib/api-auth";
import { GraphError } from "@/lib/meta/graph";
import { getCplWatch } from "@/lib/meta/cpl-watch";

/**
 * Campaigns whose cost per result has risen for a reason nobody chose.
 *
 * Two windows of the same account, compared campaign by campaign — see
 * lib/meta/cpl-watch.ts for why a rise after a budget cut is deliberately NOT
 * raised here.
 */
export async function GET(req: Request) {
  const { account, error } = await requireAccount(req);
  if (error) return error;

  if (process.env.USE_MOCK_META !== "false" || !process.env.META_ACCESS_TOKEN?.trim()) {
    return NextResponse.json(
      { error: "This compares live delivery across two windows, which needs live mode.", needsLive: true },
      { status: 409 }
    );
  }

  try {
    const result = await getCplWatch(account.id);
    return NextResponse.json({
      account: { id: account.id, name: account.name },
      baselineWindow: result.baselineWindow,
      recentWindow: result.recentWindow,
      attention: result.attention,
      // The rest, grouped, so a screen can show "12 explained by budget cuts"
      // without shipping every row it does not intend to draw.
      counts: {
        attention: result.attention.length,
        expectedAfterCut: result.rows.filter((r) => r.verdict === "EXPECTED_AFTER_CUT").length,
        scaling: result.rows.filter((r) => r.verdict === "SCALING").length,
        steady: result.rows.filter((r) => r.verdict === "STEADY").length,
        tooLittleHistory: result.rows.filter((r) => r.verdict === "TOO_LITTLE_HISTORY").length,
      },
      explained: result.rows.filter((r) => r.verdict === "EXPECTED_AFTER_CUT" || r.verdict === "SCALING"),
      notes: result.notes,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof GraphError ? err.describe() : err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
