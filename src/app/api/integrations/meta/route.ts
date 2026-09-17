import { NextResponse } from "next/server";
import { requireSession, requireAdmin } from "@/lib/api-auth";
import { metaService } from "@/lib/meta";

export async function GET() {
  const { error } = await requireSession();
  if (error) return error;

  const [status, assets] = await Promise.all([metaService.getConnectionStatus(), metaService.listAvailableAssets()]);
  return NextResponse.json({ status, assets, mode: metaService.mode });
}

export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  if (body.action === "disconnect") {
    await metaService.disconnect();
    return NextResponse.json({ ok: true });
  }
  if (body.action === "sync") {
    const result = await metaService.syncPerformance();
    return NextResponse.json(result);
  }
  // default: connect
  const status = await metaService.connect({
    businessManager: body.businessManager,
    adAccountId: body.adAccountId,
    pageId: body.pageId,
    igAccountId: body.igAccountId,
    catalogueId: body.catalogueId,
    pixelId: body.pixelId,
  });
  return NextResponse.json({ status });
}
