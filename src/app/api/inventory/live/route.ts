import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { GraphError } from "@/lib/meta/graph";
import { getCatalogueInventory } from "@/lib/meta/catalogue";

/**
 * Inventory as Meta can serve it, read from the catalogue.
 *
 * Replaces the seeded `vehicles` table, which held 4,706 generated rows with
 * placeholder images.
 */
export async function GET(req: Request) {
  const { error } = await requireSession();
  if (error) return error;

  if (process.env.USE_MOCK_META !== "false" || !process.env.META_ACCESS_TOKEN?.trim()) {
    return NextResponse.json(
      { error: "Inventory reads the live Meta catalogue, which needs live mode.", needsLive: true },
      { status: 409 }
    );
  }

  const perCity = Math.min(100, Math.max(10, Number(new URL(req.url).searchParams.get("perCity")) || 60));

  try {
    return NextResponse.json(await getCatalogueInventory(undefined, perCity));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof GraphError ? err.describe() : err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
