import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { recommendations } from "@/lib/db/schema";
import { newId } from "@/lib/id";
import {
  getAdSetMetrics,
  getAdSetSettings,
  getCityMetrics,
  getCohortTargets,
  getVehicleMetrics,
  getCampaignMetrics,
} from "@/lib/queries";
import { runAllRules, DEFAULT_RULE_PARAMS, type RuleParams } from "./rules";
import { generateAIRecommendations } from "./ai";

/**
 * Runs the rules engine (section 13) and the AI optimisation engine
 * (section 14) against current performance data, then reconciles the
 * results into the `recommendations` table:
 *  - a still-relevant PENDING item is refreshed in place (same dedupeKey)
 *  - a new issue creates a new PENDING row
 *  - anything the marketer already APPROVED/REJECTED is left untouched
 *    (no resurrecting a decision the user already made)
 *
 * Called at the top of the AI Optimiser / Recommendations / Alerts pages
 * so the feed is always current without needing a background worker in
 * this demo build. A production deployment would run this on a cron
 * (see README > "Background jobs").
 */
export async function syncRecommendations(ruleParams: RuleParams = DEFAULT_RULE_PARAMS) {
  const [cities, vehicles, campaigns, adSetMetrics, adSetSettings, targetsByCohort] = await Promise.all([
    getCityMetrics(),
    getVehicleMetrics(),
    getCampaignMetrics(),
    getAdSetMetrics(),
    getAdSetSettings(),
    getCohortTargets(),
  ]);

  const ruleTriggers = runAllRules(
    { campaigns, vehicles, cities, adSets: adSetMetrics, adSetSettings, targetsByCohort },
    ruleParams
  );
  const aiRecs = generateAIRecommendations(cities);

  const existing = await db.query.recommendations.findMany();
  const existingByKey = new Map(existing.map((r) => [r.dedupeKey, r]));

  for (const t of ruleTriggers) {
    const dedupeKey = `RULE:${t.ruleType}:${t.entityId}`;
    const found = existingByKey.get(dedupeKey);
    if (found && found.status !== "PENDING") continue; // respect prior decision
    const values = {
      source: "RULE" as const,
      ruleType: t.ruleType,
      scope: t.scope,
      title: `${t.entityLabel}: ${t.message}`,
      reasons: JSON.stringify([t.message]),
      recommendedAction: t.action,
      suggestedDailyBudget: t.suggestedDailyBudget ?? null,
      cityId: t.scope === "CITY" ? t.entityId : null,
      campaignId: t.scope === "CAMPAIGN" ? t.entityId : null,
      vehicleId: t.scope === "VEHICLE" ? t.entityId : null,
      impactEstimate: t.evidenceCohort ? `Evidence cohort: ${t.evidenceCohort}` : null,
      dedupeKey,
    };
    if (found) {
      await db.update(recommendations).set(values).where(eq(recommendations.id, found.id));
    } else {
      await db.insert(recommendations).values({ id: newId("rec"), status: "PENDING", ...values });
    }
  }

  for (const r of aiRecs) {
    const dedupeKey = `AI:${r.scope}:${r.cityId ?? r.campaignId ?? r.vehicleId ?? "account"}:${r.title}`;
    const found = existingByKey.get(dedupeKey);
    if (found && found.status !== "PENDING") continue;
    const values = {
      source: "AI" as const,
      ruleType: null,
      scope: r.scope,
      title: r.title,
      reasons: JSON.stringify(r.reasons),
      recommendedAction: r.recommendedAction,
      impactEstimate: r.impactEstimate ?? null,
      suggestedDailyBudget: r.suggestedDailyBudget ?? null,
      cityId: r.cityId ?? null,
      campaignId: r.campaignId ?? null,
      vehicleId: r.vehicleId ?? null,
      dedupeKey,
    };
    if (found) {
      await db.update(recommendations).set(values).where(eq(recommendations.id, found.id));
    } else {
      await db.insert(recommendations).values({ id: newId("rec"), status: "PENDING", ...values });
    }
  }

  // Withdraw rule-sourced recommendations that no longer fire.
  //
  // Without this the feed only ever grows: a city flagged for low inventory
  // keeps that card forever, even after the rule stops producing it, because
  // reconciliation only ever updated or inserted. A recommendation nobody can
  // act on any more is worse than no recommendation — it teaches the reader to
  // ignore the feed. Decisions the user already made (APPROVED / REJECTED) are
  // history and are left alone.
  const liveKeys = new Set([
    ...ruleTriggers.map((t) => `RULE:${t.ruleType}:${t.entityId}`),
    ...aiRecs.map((r) => `AI:${r.scope}:${r.cityId ?? r.campaignId ?? r.vehicleId ?? "account"}:${r.title}`),
  ]);
  const stale = existing.filter((r) => r.status === "PENDING" && !liveKeys.has(r.dedupeKey));
  if (stale.length > 0) {
    await db.delete(recommendations).where(
      inArray(
        recommendations.id,
        stale.map((r) => r.id)
      )
    );
  }

  return db.query.recommendations.findMany({
    with: { city: true, campaign: true, resolvedBy: true },
    orderBy: (rec, { desc }) => [desc(rec.createdAt)],
  });
}
