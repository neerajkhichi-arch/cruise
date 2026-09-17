import { getCityMetrics, getAdSetMetrics, getAdSetSettings, getCohortTargets, getCampaignMetrics, getVehicleMetrics } from "../src/lib/queries";
import { runAllRules } from "../src/lib/engine/rules";
import { describeSource } from "../src/lib/engine/replicate";
import { db } from "../src/lib/db/client";
import { adSets as adSetsTable } from "../src/lib/db/schema";
import { writeFileSync } from "fs";

async function main(){
  const [cities, adSets, settings, targets, campaigns, campaigns7d, vehicles] = await Promise.all([
    getCityMetrics(), getAdSetMetrics(), getAdSetSettings(), getCohortTargets(),
    getCampaignMetrics("30d"), getCampaignMetrics("7d"), getVehicleMetrics(),
  ]);
  const c7 = new Map(campaigns7d.map((c) => [c.campaignId, c]));

  // Replication sources, derived the same way the API derives them, so the
  // preview cannot drift from what the running product would offer.
  const adSetRows = await db.select().from(adSetsTable);
  const campaignIdByAdSet = new Map(adSetRows.map((a) => [a.id, a.campaignId]));
  const byCampaign = new Map<string, typeof settings>();
  for (const s of settings) {
    const cid = campaignIdByAdSet.get(s.adSetId);
    if (!cid) continue;
    const bucket = byCampaign.get(cid);
    if (bucket) bucket.push(s); else byCampaign.set(cid, [s]);
  }
  const sources = campaigns
    .map((c) => describeSource(c, byCampaign.get(c.campaignId) ?? []))
    .filter((s) => s.adSets.length > 0);
  const triggers = runAllRules({cities,vehicles,campaigns,adSets,adSetSettings:settings,targetsByCohort:targets});
  const settingsById = new Map(settings.map(s=>[s.adSetId,s]));
  writeFileSync("/tmp/preview-data.json", JSON.stringify({
    cities: cities.map(c=>({
      id:c.cityId, name:c.cityName, state:c.state, spend:Math.round(c.spend),
      leads:c.leads, qualifiedLeads:c.qualifiedLeads, sales:c.sales,
      cpl:Math.round(c.cpl), primaryCohortLabel:c.primaryCohortLabel,
      primaryShare:+(c.primaryCohortSpendShare).toFixed(3),
      segments:c.segments.map(s=>({label:s.label,spend:Math.round(s.spend),results:s.results,cpr:Math.round(s.costPerResult),stage:s.stage,resultType:s.resultType,attribution:s.attributionSetting})),
      dailyBudget:Math.round(c.dailyBudget), targetCpl:Math.round(c.targetCpl),
      inventoryActive:c.inventoryActive, inventoryTotal:c.inventoryTotal,
      inventoryNew7d:c.inventoryNew7d, inventoryOld60d:c.inventoryOld60d,
      ctr:+c.ctr.toFixed(2), wowCpl:+c.wowCplChange.toFixed(1), wowInv:+c.wowInventoryChange.toFixed(1),
      wowCtr:+c.wowCtrChange.toFixed(1), wowCpc:+c.wowCpcChange.toFixed(1),
    })),
    campaigns: campaigns.map(c=>{
      const w7 = c7.get(c.campaignId);
      const win = (m: typeof c | undefined) => m ? {
        spend:Math.round(m.spend), leads:m.leads, cpl:+m.cpl.toFixed(2),
        ctr:+m.ctr.toFixed(2), cpc:+m.cpc.toFixed(2), cpm:+m.cpm.toFixed(2),
        impressions:m.impressions, clicks:m.clicks, reach:m.reach,
        frequency:+m.frequency.toFixed(2),
      } : null;
      return {
        id:c.campaignId, name:c.name, status:c.status, cities:c.cities,
        cityName:c.cities[0] ?? "—", stage:c.stage,
        resultType:c.resultType, attribution:c.attributionSetting, cohort:c.cohort,
        dailyBudget:Math.round(c.dailyBudget), totalBudget:Math.round(c.totalBudget),
        targetCpl:Math.round(c.targetCpl), inventoryCount:c.inventoryCount,
        daysRunning:c.daysRunning,
        m30: win(c), m7: win(w7),
      };
    }),
    // Everything the replicate flow needs: what can be copied, and why it
    // might be a poor thing to copy.
    replicationSources: sources.map(s=>({
      campaignId:s.campaignId, name:s.name, cities:s.cities,
      dailyBudget:Math.round(s.dailyBudget), targetCpl:Math.round(s.targetCpl),
      catalogueId:s.catalogueId, catalogueName:s.catalogueName,
      resultType:s.resultType, attribution:s.attributionSetting,
      adSets:s.adSets.map(a=>({name:a.name, kind:a.kind, ageMin:a.ageMin, ageMax:a.ageMax, lookalikeSource:a.lookalikeSource})),
      cautions:s.cautions,
    })),
    adSets: adSets.filter(a=>a.spend>0).map(a=>{
      const s = settingsById.get(a.adSetId)!;
      return {
        id:a.adSetId, campaignId:a.campaignId, name:a.name, status:a.status, city:a.cityName,
        stage:a.stage, resultType:a.resultType, attribution:a.attributionSetting, cohort:a.cohort,
        spend:Math.round(a.spend), results:a.results, cpr:+a.costPerResult.toFixed(2),
        spend7d:Math.round(a.spend7d), results7d:a.results7d, cpr7d:+a.costPerResult7d.toFixed(2),
        frequency:+a.frequency.toFixed(2), reach:a.reach, ctr:+a.ctr.toFixed(2),
        customAudiences:a.customAudiences, interests:s.interests,
        geo:[...s.geoCities,...s.geoRegions], ageMin:a.ageMin, ageMax:a.ageMax,
        genders:a.genders, advantage:a.advantageAudience,
      };
    }).sort((x,y)=>y.spend-x.spend),
    cohorts: [...targets].map(([k,v])=>({cohort:k, benchmark:Math.round(v)})),
    triggers: triggers.filter(t=>t.scope!=="VEHICLE").map(t=>({
      ruleType:t.ruleType, scope:t.scope, label:t.entityLabel, message:t.message,
      action:t.action, severity:t.severity, cohort:t.evidenceCohort??null,
    })),
    vehicleTriggers: triggers.filter(t=>t.scope==="VEHICLE").slice(0,4).map(t=>({
      ruleType:t.ruleType, label:t.entityLabel, message:t.message, action:t.action, severity:t.severity,
    })),
  }, null, 1));
  console.log("exported");
  process.exit(0);
}
main();
