import { NextResponse } from "next/server";
import { requireAccount } from "@/lib/api-auth";
import { GraphError } from "@/lib/meta/graph";
import { buildRecommendations } from "@/lib/meta/recommend";

/**
 * Live budget recommendations.
 *
 * Separate from /api/recommendations, which serves the stored ones. This one
 * computes from Meta on request — there is no value in a cached opinion about
 * yesterday's delivery.
 */
export async function GET(req: Request) {
  const { account, error } = await requireAccount(req);
  if (error) return error;

  if (process.env.USE_MOCK_META !== "false" || !process.env.META_ACCESS_TOKEN?.trim()) {
    return NextResponse.json(
      { error: "Recommendations read live delivery from Meta, which needs live mode.", needsLive: true },
      { status: 409 }
    );
  }

  try {
    const result = await buildRecommendations(
      account.id
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof GraphError ? err.describe() : err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
