import { db } from "../src/lib/db/client";
import { getCityMetrics, getAdSetMetrics, getAdSetSettings, getCohortTargets, getCampaignMetrics, getVehicleMetrics } from "../src/lib/queries";
import { runAllRules } from "../src/lib/engine/rules";
import { REAL_AD_SETS } from "./real-account-data";
import { performanceDaily } from "../src/lib/db/schema";

const inr = (n:number)=>`₹${Math.round(n).toLocaleString("en-IN")}`;

async function main(){
  // 1. 30d sums must equal the real API totals, exactly.
  const rows = await db.select().from(performanceDaily);
  const bySet = new Map<string,{spend:number;res:number}>();
  for(const r of rows){ const b=bySet.get(r.adSetId!)??{spend:0,res:0}; b.spend+=r.spend; b.res+=r.leads; bySet.set(r.adSetId!,b); }
  let worstSpend=0, worstRes=0, checked=0;
  for(const a of REAL_AD_SETS){
    if(a.spend<=0) continue;
    const b=bySet.get(a.id); if(!b) continue;
    checked++;
    worstSpend=Math.max(worstSpend, Math.abs(b.spend-a.spend));
    worstRes=Math.max(worstRes, Math.abs(b.res-a.results));
  }
  console.log(`[1] Reconstructed ${checked} ad sets. Max spend drift ${worstSpend.toFixed(4)}, max result drift ${worstRes}.`);

  // 2. Cities must expose segments, never one blended number.
  const cities = await getCityMetrics();
  console.log(`\n[2] City cost segments (no blending):`);
  for(const c of cities.filter(c=>c.segments.length)){
    console.log(`  ${c.cityName}: primary = ${c.primaryCohortLabel} @ ${inr(c.cpl)} (${Math.round(c.primaryCohortSpendShare*100)}% of spend), ${c.segments.length} segment(s)`);
    for(const s of c.segments) console.log(`      ${s.label}: ${inr(s.spend)} / ${s.results} = ${inr(s.costPerResult)}`);
  }

  // 3. Cohort benchmarks
  const targets = await getCohortTargets();
  console.log(`\n[3] Cohort benchmarks (the only valid comparison basis):`);
  for(const [k,v] of targets) console.log(`  ${k} = ${inr(v)}`);

  // 4. Rules
  const [vehicles, campaigns, adSets, settings] = await Promise.all([getVehicleMetrics(),getCampaignMetrics(),getAdSetMetrics(),getAdSetSettings()]);
  const triggers = runAllRules({cities,vehicles,campaigns,adSets,adSetSettings:settings,targetsByCohort:targets});
  const counts = triggers.reduce((m,t)=>{m[t.ruleType]=(m[t.ruleType]??0)+1; return m;},{} as Record<string,number>);
  console.log(`\n[4] Rules fired: ${triggers.length}`, counts);
  for(const t of triggers.filter(t=>["UNDERFUNDED_WINNER","GEO_SELF_COMPETITION","AUDIENCE_EXHAUSTION","UNCONTROLLED_TEST_VARIABLE"].includes(t.ruleType))){
    console.log(`\n  [${t.ruleType}] ${t.entityLabel}\n    ${t.message}\n    -> ${t.action}`);
  }

  // 5. Names must not determine stage.
  console.log(`\n[5] Name-vs-reality check:`);
  for(const a of adSets.filter(a=>a.spend>20000)){
    const nameSays = /rem|retarget/i.test(a.name) ? "REMARKETING" : /combin|consolidat|broad|detailed/i.test(a.name) ? "PROSPECTING" : "unclear";
    const flag = nameSays!=="unclear" && nameSays!==a.stage ? "  <-- NAME IS WRONG" : "";
    console.log(`  ${a.name.padEnd(42)} name says ${nameSays.padEnd(12)} settings say ${a.stage}${flag}`);
  }
  process.exit(0);
}
main();
