import { NextResponse } from "next/server";
import { requireAccount } from "@/lib/api-auth";
import { GraphError } from "@/lib/meta/graph";
import { MIN_TARGETABLE_AUDIENCE, listCustomAudiences } from "@/lib/meta/audiences";

/**
 * The account's existing custom audiences, so a replica can be pointed at one.
 *
 * There is no local fallback. An audience list is only useful if it is the real
 * one — offering a remembered list would let an operator pick an audience that
 * has since been deleted, and find out at publish time.
 */
export async function GET(req: Request) {
  const { account, error } = await requireAccount(req);
  if (error) return error;

  if (process.env.USE_MOCK_META !== "false" || !process.env.META_ACCESS_TOKEN?.trim()) {
    return NextResponse.json(
      { error: "Reading your Meta audiences needs live mode.", needsLive: true, audiences: [] },
      { status: 409 }
    );
  }

  try {
    const audiences = await listCustomAudiences(
      account.id
    );
    return NextResponse.json({
      audiences,
      minTargetable: MIN_TARGETABLE_AUDIENCE,
      targetableCount: audiences.filter((a) => a.targetable).length,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof GraphError ? err.describe() : err instanceof Error ? err.message : String(err),
        audiences: [],
      },
      { status: 502 }
    );
  }
}
