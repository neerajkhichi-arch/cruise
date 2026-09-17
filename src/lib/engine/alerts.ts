import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { alerts } from "@/lib/db/schema";
import { newId } from "@/lib/id";
import { getCityMetrics, getCampaignMetrics, getVehicleMetrics } from "@/lib/queries";

interface AlertCandidate {
  type: (typeof alerts.$inferInsert)["type"];
  severity: (typeof alerts.$inferInsert)["severity"];
  title: string;
  message: string;
  cityId?: string;
}

/**
 * Derives the Alerts Centre feed (spec section 20) from live performance
 * data and persists any newly-detected condition. Alerts are deduped by
 * (type, city) so re-running this doesn't spam duplicates — see
 * README > "Background jobs" for how this maps to a real cron worker.
 */
export async function syncAlerts() {
  const [cities, campaigns, vehicles] = await Promise.all([getCityMetrics(), getCampaignMetrics(), getVehicleMetrics()]);
  const candidates: AlertCandidate[] = [];

  for (const c of cities) {
    if (c.wowCplChange > 15) {
      candidates.push({
        type: "CPL_SPIKE",
        severity: "CRITICAL",
        title: `${c.cityName} CPL spike`,
        message: `CPL rose ${Math.round(c.wowCplChange)}% week-over-week to ₹${Math.round(c.cpl)}.`,
        cityId: c.cityId,
      });
    }
    if (c.wowCplChange < -12 && c.leads > 20) {
      candidates.push({
        type: "CPL_IMPROVEMENT",
        severity: "SUCCESS",
        title: `${c.cityName} CPL improving`,
        message: `CPL fell ${Math.round(Math.abs(c.wowCplChange))}% week-over-week to ₹${Math.round(c.cpl)}.`,
        cityId: c.cityId,
      });
    }
    // Only for cities that are actually running. A city launched this week has
    // zero inventory because no catalogue feed is connected, not because stock
    // "fell" — and telling it to cut budget on day one is noise.
    if (c.spend > 0 && c.inventoryActive < 300) {
      candidates.push({
        type: "INVENTORY_SHORTAGE",
        severity: "WARNING",
        title: `${c.cityName} inventory shortage`,
        message: `Active inventory has fallen to ${c.inventoryActive} units, below the 300-unit threshold.`,
        cityId: c.cityId,
      });
    }
    if (c.cpl < c.targetCpl * 0.8 && c.leads > 50) {
      candidates.push({
        type: "HIGH_PERFORMING_CITY",
        severity: "SUCCESS",
        title: `${c.cityName} is high-performing`,
        message: `CPL of ₹${Math.round(c.cpl)} is ${Math.round((1 - c.cpl / c.targetCpl) * 100)}% under the ₹${c.targetCpl} target with strong lead volume.`,
        cityId: c.cityId,
      });
    }
  }

  for (const camp of campaigns) {
    if (camp.status !== "ACTIVE") continue;
    if (camp.spend / 7 > camp.dailyBudget * 1.15) {
      candidates.push({
        type: "OVERSPEND",
        severity: "CRITICAL",
        title: `${camp.name} is overspending`,
        message: `Averaging ₹${Math.round(camp.spend / 7).toLocaleString("en-IN")}/day against a ₹${Math.round(camp.dailyBudget).toLocaleString("en-IN")} daily budget.`,
      });
    }
    if (camp.frequency > 3.2) {
      candidates.push({
        type: "CREATIVE_FATIGUE",
        severity: "WARNING",
        title: `${camp.name} shows creative fatigue`,
        message: `Frequency has reached ${camp.frequency.toFixed(1)} — audience is seeing the same creative too often.`,
      });
    }
  }

  const soldButActive = vehicles.filter((v) => v.availability === "SOLD" && v.spend > 0);
  for (const v of soldButActive.slice(0, 5)) {
    candidates.push({
      type: "SOLD_VEHICLE_ACTIVE",
      severity: "CRITICAL",
      title: `${v.label} sold but still active`,
      message: `${v.label} in ${v.cityName} is marked SOLD but has spent ₹${Math.round(v.spend)}.`,
    });
  }

  const key = (a: { type: string; cityId?: string | null; title: string }) =>
    `${a.type}:${a.cityId ?? "none"}:${a.title}`;

  const existing = await db.select().from(alerts);
  const existingKeys = new Set(existing.map(key));
  const liveKeys = new Set(candidates.map(key));

  const toInsert = candidates.filter((c) => !existingKeys.has(key(c)));
  for (const c of toInsert) {
    await db.insert(alerts).values({ id: newId("alert"), ...c });
  }

  // Clear alerts whose condition no longer holds. An alerts centre that only
  // accumulates stops being read: the reader cannot tell which entries still
  // describe the account. Alerts the user has already read are kept as history.
  const stale = existing.filter((a) => !a.read && !liveKeys.has(key(a)));
  if (stale.length > 0) {
    await db.delete(alerts).where(
      inArray(
        alerts.id,
        stale.map((a) => a.id)
      )
    );
  }

  return db.query.alerts.findMany({ with: { city: true }, orderBy: (a, { desc }) => [desc(a.createdAt)] });
}

export async function markAlertRead(id: string) {
  await db.update(alerts).set({ read: true }).where(eq(alerts.id, id));
}

export async function markAllAlertsRead() {
  await db.update(alerts).set({ read: true }).where(eq(alerts.read, false));
}
