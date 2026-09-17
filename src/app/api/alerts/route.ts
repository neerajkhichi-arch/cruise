import { NextResponse } from "next/server";
import { requireSession, requireEditor } from "@/lib/api-auth";
import { syncAlerts, markAlertRead, markAllAlertsRead } from "@/lib/engine/alerts";

export async function GET(req: Request) {
  const { error } = await requireSession();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unreadOnly") === "true";

  let rows = await syncAlerts();
  if (unreadOnly) rows = rows.filter((a) => !a.read);

  return NextResponse.json({
    alerts: rows.map((a) => ({
      id: a.id,
      type: a.type,
      severity: a.severity,
      title: a.title,
      message: a.message,
      cityName: a.city?.name,
      read: a.read,
      createdAt: a.createdAt.toISOString(),
    })),
    total: rows.length,
  });
}

export async function PATCH(req: Request) {
  const { error } = await requireEditor();
  if (error) return error;
  const body = await req.json();

  if (body.markAll) {
    await markAllAlertsRead();
    return NextResponse.json({ ok: true });
  }
  if (body.id) {
    await markAlertRead(body.id);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "id or markAll required" }, { status: 400 });
}
