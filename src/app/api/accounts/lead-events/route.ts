import { NextResponse } from "next/server";
import { requireAccount } from "@/lib/api-auth";
import { GraphError } from "@/lib/meta/graph";
import { discoverLeadActions } from "@/lib/meta/lead-events";
import { leadActionType } from "@/lib/meta/city-leads";

/**
 * What this account actually reports as a conversion, so the lead event can be
 * chosen from a list rather than typed from memory.
 *
 * Scoped by requireAccount like every other Meta read: the answer depends
 * entirely on which ad account is being asked about, and a person may only ask
 * about accounts granted to them.
 */
export async function GET(req: Request) {
  const { account, error } = await requireAccount(req);
  if (error) return error;

  if (process.env.USE_MOCK_META !== "false" || !process.env.META_ACCESS_TOKEN?.trim()) {
    return NextResponse.json(
      { error: "Detecting lead events reads live delivery from Meta, which needs live mode.", needsLive: true },
      { status: 409 }
    );
  }

  try {
    // leadActionType() resolves through the account context requireAccount just
    // entered, so "current" is the value this account is really being measured
    // by — not the environment default.
    const result = await discoverLeadActions(account.id, leadActionType());
    return NextResponse.json({ account: { id: account.id, name: account.name }, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof GraphError ? err.describe() : err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
