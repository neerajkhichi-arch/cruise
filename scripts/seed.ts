/* eslint-disable no-console */
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { faker } from "@faker-js/faker";
import "dotenv/config";
import { db, pool } from "../src/lib/db/client";
import {
  users,
  cities,
  vehicles,
  campaigns,
  campaignCities,
  adSets as adSetsTable,
  performanceDaily,
  leads,
  optimisationRules,
  recommendations,
  alerts,
  accountSettings,
  namingConvention,
  metaIntegration,
} from "../src/lib/db/schema";
import { newId } from "../src/lib/id";
import { vehiclePerformanceScore, inventoryHealthScore } from "../src/lib/engine/scoring";
import { DEFAULT_RULE_PARAMS, type RuleType } from "../src/lib/engine/rules";
import { DEFAULT_NAMING_TEMPLATE } from "../src/lib/engine/naming";
import { REAL_AD_SETS, REAL_CAMPAIGNS, REAL_CITIES } from "./real-account-data";
import { REAL_CATALOGUES, REAL_PRODUCT_SETS, DEFAULT_CATALOGUE_ID } from "./real-catalogue-data";

type VehicleAvailability = "ACTIVE" | "SOLD" | "RESERVED";
type CampaignObjective = "LEADS" | "WHATSAPP_LEADS" | "WEBSITE_LEADS";
type CampaignStatus = "ACTIVE" | "PAUSED" | "DRAFT" | "COMPLETED";
type AudienceType = "BROAD" | "LOOKALIKE" | "RETARGETING" | "CUSTOM";
type StructureType = "DEDICATED_CITY" | "STANDARD_CITY" | "CITY_CLUSTER";
type LeadStage = "LEAD" | "VALID" | "QUALIFIED" | "SOLD" | "INVALID";

faker.seed(1312);

const DAY = 24 * 60 * 60 * 1000;
const TODAY = new Date();
const HISTORY_DAYS = 30;

// ---------------------------------------------------------------------------
// City profiles
// ---------------------------------------------------------------------------
type Trend = "improving" | "stable" | "attention" | "critical";

interface CityProfile {
  name: string;
  state: string;
  tier: string;
  totalInventory: number;
  activePct: number; // fraction of total that stays ACTIVE
  targetCpl: number;
  dailyBudget: number;
  trend: Trend;
  priceRange: [number, number];
}

// Cities the account actually runs, with budget and cost taken from the live
// 30-day pull (see scripts/real-account-data.ts). `targetCpl` is the cost per
// result of each city's DOMINANT cohort — not a blend and not an aspiration.
//
// Inventory figures below are the one remaining synthetic input: no catalogue
// or product feed is connected, so vehicle counts and prices are generated.
// Replace these once the feed lands; nothing else in this file is invented.
/**
 * Real vehicle counts, from the city product sets in the live catalogue
 * Catalog_Vehicles-Pan-India-20-July. These replace the generated totals that
 * used to sit in the profiles below — inventory depth is no longer invented for
 * any city that has a product set.
 */
const REAL_INVENTORY: Record<string, number> = Object.fromEntries(
  REAL_PRODUCT_SETS.filter((p) => p.cityKey).map((p) => [p.cityKey as string, p.productCount])
);

const CITY_PROFILES: CityProfile[] = [
  { name: "Ahmedabad", state: "Gujarat", tier: "Tier 1", totalInventory: 1500, activePct: 0.9, targetCpl: 87.76, dailyBudget: 5549, trend: "improving", priceRange: [280000, 1400000] },
  { name: "Nashik", state: "Maharashtra", tier: "Tier 2", totalInventory: 620, activePct: 0.87, targetCpl: 100.62, dailyBudget: 7626, trend: "stable", priceRange: [250000, 1100000] },
  { name: "Chandigarh", state: "Chandigarh", tier: "Tier 2", totalInventory: 380, activePct: 0.72, targetCpl: 97.87, dailyBudget: 2501, trend: "attention", priceRange: [270000, 1300000] },
  { name: "Mohali", state: "Punjab", tier: "Tier 2", totalInventory: 340, activePct: 0.7, targetCpl: 117.1, dailyBudget: 3455, trend: "critical", priceRange: [260000, 1250000] },
  { name: "Delhi NCR", state: "Delhi", tier: "Tier 1", totalInventory: 900, activePct: 0.85, targetCpl: 78.8, dailyBudget: 381, trend: "stable", priceRange: [320000, 1800000] },
];

const MAKE_MODELS: { make: string; models: { model: string; variants: string[]; base: number }[] }[] = [
  { make: "Maruti Suzuki", models: [
    { model: "Swift", variants: ["LXI", "VXI", "ZXI", "ZXI+"], base: 550000 },
    { model: "Baleno", variants: ["Sigma", "Delta", "Zeta", "Alpha"], base: 650000 },
    { model: "Dzire", variants: ["LXI", "VXI", "ZXI"], base: 600000 },
    { model: "Ertiga", variants: ["VXI", "ZXI", "ZXI+"], base: 850000 },
  ]},
  { make: "Hyundai", models: [
    { model: "Creta", variants: ["E", "EX", "S", "SX", "SX(O)"], base: 1150000 },
    { model: "i20", variants: ["Magna", "Sportz", "Asta"], base: 750000 },
    { model: "Venue", variants: ["E", "S", "SX", "SX(O)"], base: 900000 },
    { model: "Verna", variants: ["S", "SX", "SX(O)"], base: 1050000 },
  ]},
  { make: "Tata", models: [
    { model: "Nexon", variants: ["XE", "XM", "XZ", "XZ+"], base: 850000 },
    { model: "Punch", variants: ["Pure", "Adventure", "Creative"], base: 650000 },
    { model: "Harrier", variants: ["XE", "XM", "XZ"], base: 1450000 },
    { model: "Tiago", variants: ["XE", "XM", "XZ"], base: 500000 },
  ]},
  { make: "Mahindra", models: [
    { model: "XUV700", variants: ["MX", "AX3", "AX5", "AX7"], base: 1600000 },
    { model: "XUV300", variants: ["W4", "W6", "W8"], base: 900000 },
    { model: "Scorpio-N", variants: ["Z2", "Z4", "Z6"], base: 1400000 },
    { model: "Bolero", variants: ["B4", "B6"], base: 800000 },
  ]},
  { make: "Honda", models: [
    { model: "City", variants: ["V", "VX", "ZX"], base: 1100000 },
    { model: "Amaze", variants: ["E", "S", "VX"], base: 650000 },
    { model: "WR-V", variants: ["S", "SV", "VX"], base: 900000 },
  ]},
  { make: "Toyota", models: [
    { model: "Innova Crysta", variants: ["GX", "VX", "ZX"], base: 1800000 },
    { model: "Glanza", variants: ["G", "V"], base: 700000 },
    { model: "Urban Cruiser", variants: ["Mid", "High"], base: 950000 },
  ]},
  { make: "Kia", models: [
    { model: "Seltos", variants: ["HTE", "HTK", "HTX", "GTX"], base: 1150000 },
    { model: "Sonet", variants: ["HTE", "HTK", "HTX"], base: 850000 },
  ]},
  { make: "Renault", models: [
    { model: "Kwid", variants: ["RXE", "RXL", "RXT"], base: 400000 },
    { model: "Triber", variants: ["RXE", "RXL", "RXT"], base: 600000 },
  ]},
  { make: "Volkswagen", models: [
    { model: "Polo", variants: ["Trendline", "Comfortline", "Highline"], base: 700000 },
    { model: "Virtus", variants: ["Dynamic", "Performance"], base: 1050000 },
  ]},
  { make: "Ford", models: [
    { model: "EcoSport", variants: ["Ambiente", "Trend", "Titanium"], base: 750000 },
  ]},
];

const FUELS = ["Petrol", "Diesel", "CNG", "Electric"];
const TRANSMISSIONS = ["Manual", "Automatic"];
const DEALERS = [
  "Girnar Certified Cars",
  "TrustDrive Motors",
  "CarBazaar Select",
  "AutoMax Pre-Owned",
  "SpinnyPoint Retail",
  "CarWale Assured Hub",
  "Blue Ribbon Autos",
  "Wheel Deal Cars",
];

function randBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}
function randInt(min: number, max: number) {
  return Math.floor(randBetween(min, max + 1));
}
function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}
function paretoWeight() {
  return Math.pow(Math.random(), 2.2);
}

async function main() {
  console.log("Seeding AutoCampaign AI demo data...");

  // -------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------
  const passwordHash = await bcrypt.hash("demo1234", 10);
  await db.delete(users);
  await db.insert(users).values([
    { id: newId("usr"), name: "Aarav Shah", email: "admin@autocampaign.ai", role: "ADMIN", passwordHash, avatarColor: "#2a41e8" },
    { id: newId("usr"), name: "Meera Kulkarni", email: "manager@autocampaign.ai", role: "MANAGER", passwordHash, avatarColor: "#16a34a" },
    { id: newId("usr"), name: "Rohan Verma", email: "viewer@autocampaign.ai", role: "VIEWER", passwordHash, avatarColor: "#d97706" },
    { id: newId("usr"), name: "Priya Nair", email: "priya.nair@autocampaign.ai", role: "MANAGER", passwordHash, avatarColor: "#9333ea" },
  ]);

  // -------------------------------------------------------------------
  // Account-wide settings
  // -------------------------------------------------------------------
  await db.delete(accountSettings);
  await db.insert(accountSettings).values({ id: "singleton" });

  await db.delete(namingConvention);
  await db.insert(namingConvention).values({ id: "singleton", template: DEFAULT_NAMING_TEMPLATE });

  await db.delete(metaIntegration);
  await db.insert(metaIntegration).values({
    id: "singleton",
    connected: true,
    businessManager: "Girnar Motors Retail Group",
    adAccountId: "act_10298374651",
    adAccountName: "Girnar Motors Retail Group",
    pageId: "pg_5518823",
    pageName: "Girnar Motors | Certified Used Cars",
    igAccountId: "ig_9911223",
    igUsername: "@girnarmotors",
    catalogueId: "cat_77321098",
    catalogueName: "UsedCars-Master-Catalogue",
    pixelId: "pxl_44102938",
    capiEnabled: true,
    connectedAt: new Date(),
  });

  await db.delete(optimisationRules);
  const ruleNameMap: Record<RuleType, { name: string; description: string }> = {
    REDUCE_BUDGET_HIGH_CPL: { name: "Reduce budget on high CPL", description: "If CPL exceeds target by 20%+ for 3+ days, reduce budget by 15%." },
    INCREASE_BUDGET_LOW_CPL: { name: "Increase budget on low CPL", description: "If CPL is 20%+ below target and lead volume is rising, increase budget by 15%." },
    DEACTIVATE_SOLD_VEHICLE: { name: "Deactivate sold vehicles", description: "Remove a vehicle from advertising the moment it's marked sold." },
    FLAG_NO_LEAD_VEHICLE: { name: "Flag no-lead vehicles", description: "Flag any vehicle that spends ₹500+ without generating a lead." },
    LOW_INVENTORY_WARNING: { name: "Low inventory warning", description: "Warn when a city's active inventory falls below 300 units." },
    UNDERFUNDED_WINNER: {
      name: "Underfunded winner",
      description: "Flag an ad set beating its own comparison cohort on cost per result while holding a small share of that cohort's spend.",
    },
    GEO_SELF_COMPETITION: {
      name: "Geo self-competition",
      description: "Flag two live ad sets whose geo targeting overlaps, so they bid against each other in the same auction.",
    },
    AUDIENCE_EXHAUSTION: {
      name: "Audience exhaustion",
      description: "Flag a remarketing ad set whose frequency has passed the ceiling, since a custom audience refills only as fast as site traffic.",
    },
    UNCONTROLLED_TEST_VARIABLE: {
      name: "Uncontrolled test variable",
      description: "Flag a city whose live ad sets differ on age, gender or attribution, making any cost comparison between them unreadable.",
    },
  };
  for (const type of Object.keys(DEFAULT_RULE_PARAMS) as RuleType[]) {
    await db.insert(optimisationRules).values({
      id: newId("rule"),
      type,
      name: ruleNameMap[type].name,
      description: ruleNameMap[type].description,
      enabled: true,
      params: JSON.stringify((DEFAULT_RULE_PARAMS as any)[type]),
    });
  }

  // -------------------------------------------------------------------
  // Cities
  // -------------------------------------------------------------------
  await db.delete(performanceDaily);
  await db.delete(leads);
  await db.delete(recommendations);
  await db.delete(alerts);
  await db.delete(campaignCities);
  await db.delete(adSetsTable);
  await db.delete(campaigns);
  await db.delete(vehicles);
  await db.delete(cities);

  const cityRecords: Record<string, { id: string; profile: CityProfile }> = {};
  for (const profile of CITY_PROFILES) {
    // Where the live catalogue has a city product set, its product count is the
    // inventory. Only cities without one keep a generated figure.
    const real = REAL_INVENTORY[profile.name.toLowerCase()];
    if (real !== undefined) profile.totalInventory = Math.round(real / profile.activePct);
    const status = profile.trend === "critical" ? "CRITICAL" : profile.trend === "attention" ? "ATTENTION" : "HEALTHY";
    const cityId = newId("city");
    await db.insert(cities).values({
      id: cityId,
      name: profile.name,
      state: profile.state,
      tier: profile.tier,
      status,
      dailyBudget: profile.dailyBudget,
      recommendedBudget: profile.dailyBudget,
      targetCpl: profile.targetCpl,
    });
    cityRecords[profile.name] = { id: cityId, profile };
  }
  console.log(`Created ${CITY_PROFILES.length} cities`);

  // Real-account city id ("ahmedabad") -> the row id we just generated.
  const realCityToRowId = new Map<string, string>();
  for (const rc of REAL_CITIES) {
    const rec = cityRecords[rc.name];
    if (rec) realCityToRowId.set(rc.id, rec.id);
  }

  // -------------------------------------------------------------------
  // Vehicles
  // -------------------------------------------------------------------
  let vehicleCounter = 10000;

  for (const profile of CITY_PROFILES) {
    const cityId = cityRecords[profile.name].id;
    const vehiclesToCreate = [];
    const activeCount = Math.round(profile.totalInventory * profile.activePct);
    const soldCount = profile.totalInventory - activeCount;

    for (let i = 0; i < profile.totalInventory; i++) {
      const makeDef = pick(MAKE_MODELS);
      const modelDef = pick(makeDef.models);
      const variant = pick(modelDef.variants);
      const year = randInt(2016, 2024);
      const ageFactor = (2025 - year) * 0.08;
      const priceNoise = randBetween(0.85, 1.15);
      const price = Math.round((modelDef.base * (1 - ageFactor) * priceNoise) / 5000) * 5000;
      const isSold = i < soldCount;
      // Skew listedAt so ~25% of active stock is 60+ days old (more so for "critical" cities).
      const agedBias = profile.trend === "critical" ? 0.45 : profile.trend === "attention" ? 0.3 : 0.22;
      const ageDays = Math.random() < agedBias ? randInt(60, 150) : randInt(0, 59);
      const listedAt = new Date(TODAY.getTime() - ageDays * DAY);
      const hasRecentPriceChange = Math.random() < 0.12;

      vehicleCounter++;
      const code = `UC-${profile.name.slice(0, 3).toUpperCase()}-${vehicleCounter}`;
      const imgSeed = `${profile.name}-${vehicleCounter}`.replace(/\s/g, "");

      vehiclesToCreate.push({
        id: newId("veh"),
        vehicleCode: code,
        make: makeDef.make,
        model: modelDef.model,
        variant,
        year,
        price,
        previousPrice: hasRecentPriceChange ? Math.round(price * randBetween(1.03, 1.1) / 5000) * 5000 : null,
        fuel: pick(FUELS.slice(0, modelDef.model === "XUV700" || modelDef.model === "Nexon" ? 4 : 2)),
        transmission: pick(TRANSMISSIONS),
        kmDriven: randInt(8000, 95000),
        cityId,
        dealer: pick(DEALERS),
        images: JSON.stringify([
          `https://picsum.photos/seed/${imgSeed}-1/640/420`,
          `https://picsum.photos/seed/${imgSeed}-2/640/420`,
        ]),
        vehicleUrl: `https://marketplace.example.com/cars/${code.toLowerCase()}`,
        availability: isSold ? "SOLD" : "ACTIVE",
        listedAt,
        soldAt: isSold ? new Date(TODAY.getTime() - randInt(0, 20) * DAY) : null,
        healthScore: 70,
        performanceScore: 50,
        spend: 0,
        impressions: 0,
        clicks: 0,
        leads: 0,
      });
    }

    // Batch insert, then patch spend/leads/scores after we know city totals.
    const chunkSize = 500;
    for (let i = 0; i < vehiclesToCreate.length; i += chunkSize) {
      await db.insert(vehicles).values(vehiclesToCreate.slice(i, i + chunkSize) as any);
    }
  }
  console.log(`Created vehicles across ${CITY_PROFILES.length} cities`);

  // -------------------------------------------------------------------
  // Campaigns and ad sets — straight from the live account
  // -------------------------------------------------------------------
  // Everything below is real. Campaign and ad set names are kept EXACTLY as
  // they appear in the account, including the inconsistent ones and the two
  // ad sets that share a name, because the point of this build is that the
  // product must work without trusting names.
  const liveCatalogue = REAL_CATALOGUES.find((c) => c.catalogueId === DEFAULT_CATALOGUE_ID)!;
  const productSetByCity = new Map(
    REAL_PRODUCT_SETS.filter((p) => p.cityKey).map((p) => [p.cityKey as string, p])
  );

  for (const rc of REAL_CAMPAIGNS) {
    const adSetsForCampaign = REAL_AD_SETS.filter((a) => a.campaignId === rc.id);
    const dailyBudget = adSetsForCampaign.reduce((sum, a) => sum + a.spend, 0) / HISTORY_DAYS;
    const cityIds = [...new Set(adSetsForCampaign.map((a) => a.cityId).filter(Boolean) as string[])];
    const dominant = [...adSetsForCampaign].sort((x, y) => y.spend - x.spend)[0];

    await db.insert(campaigns).values({
      id: rc.id,
      name: rc.name,
      objective: rc.objective,
      status: rc.status,
      // Structure is a description of what the ad sets do, not a naming rule.
      structureType: cityIds.length > 1 ? "CITY_CLUSTER" : "DEDICATED_CITY",
      audienceType: dominant && dominant.customAudiences.length > 0 ? "RETARGETING" : "BROAD",
      inventoryFilter: JSON.stringify({ type: "ALL_INVENTORY", cities: cityIds }),
      catalogueName: liveCatalogue.name,
      dailyBudget: Math.round(dailyBudget),
      totalBudget: Math.round(dailyBudget * HISTORY_DAYS),
      targetCpl: dominant ? dominant.costPerResult : 0,
      createdAt: dominant?.startedAt ? new Date(dominant.startedAt) : new Date(TODAY.getTime() - 30 * DAY),
    });

    for (const rowCityId of cityIds) {
      const mapped = realCityToRowId.get(rowCityId);
      if (!mapped) continue;
      await db.insert(campaignCities).values({
        id: newId("cc"),
        campaignId: rc.id,
        cityId: mapped,
        budgetShare: 1 / cityIds.length,
      });
    }
  }
  console.log(`Created ${REAL_CAMPAIGNS.length} campaigns from the live account`);

  for (const a of REAL_AD_SETS) {
    // Bind the city's product set from the live catalogue. Ad sets with no geo
    // guardrail get none, which is itself the honest answer.
    const ps = a.cityId ? productSetByCity.get(a.cityId.replace("-ncr", "")) : undefined;
    await db.insert(adSetsTable).values({
      id: a.id,
      campaignId: a.campaignId,
      cityId: a.cityId ? realCityToRowId.get(a.cityId) ?? null : null,
      name: a.name,
      status: a.status,
      optimizationGoal: a.optimizationGoal,
      resultType: a.resultType,
      attributionSetting: a.attributionSetting,
      geoCities: JSON.stringify(a.geoCities),
      geoRegions: JSON.stringify(a.geoRegions),
      customAudiences: JSON.stringify(a.customAudiences),
      excludedAudiences: JSON.stringify(a.excludedAudiences),
      interests: JSON.stringify(a.interests),
      ageMin: a.ageMin,
      ageMax: a.ageMax,
      genders: JSON.stringify(a.genders),
      advantageAudience: a.advantageAudience,
      targetingOptimization: a.targetingOptimization,
      catalogueId: ps ? liveCatalogue.catalogueId : null,
      catalogueName: ps ? liveCatalogue.name : null,
      productSetId: ps?.productSetId ?? null,
      productSetName: ps?.name ?? null,
      productSetFilter: ps?.filterRule ?? null,
      productCount: ps?.productCount ?? 0,
      dailyBudget: a.dailyBudget || Math.round(a.spend / HISTORY_DAYS),
      spend: a.spend,
      impressions: a.impressions,
      clicks: a.clicks,
      reach: a.reach,
      frequency: a.frequency,
      results: a.results,
      costPerResult: a.costPerResult,
      spend7d: a.spend7d,
      results7d: a.results7d,
      costPerResult7d: a.costPerResult7d,
      frequency7d: a.frequency7d,
      startedAt: a.startedAt ? new Date(a.startedAt) : null,
    });
  }
  console.log(`Created ${REAL_AD_SETS.length} ad sets with real targeting settings`);

  // -------------------------------------------------------------------
  // Daily performance, reconstructed from the real 30-day and 7-day totals
  // -------------------------------------------------------------------
  // The API gives aggregates, not a daily series. We distribute each ad set's
  // real totals across the window so the dashboards have a shape to draw,
  // under two hard constraints: the 30-day sums equal the real numbers exactly,
  // and the trailing 7 days equal the real 7-day numbers exactly where we have
  // them. Every row carries its ad set's result type and attribution window so
  // nothing downstream can silently blend incomparable costs.
  const perfRows: any[] = [];
  const leadRows: any[] = [];

  /** Split `total` into `n` positive parts that sum exactly to `total`. */
  function splitExact(total: number, n: number, jitter = 0.25): number[] {
    if (n <= 0) return [];
    if (total <= 0) return new Array(n).fill(0);
    const weights = Array.from({ length: n }, () => 1 + (Math.random() * 2 - 1) * jitter);
    const wsum = weights.reduce((x, y) => x + y, 0);
    const parts = weights.map((w) => (w / wsum) * total);
    const drift = total - parts.reduce((x, y) => x + y, 0);
    parts[parts.length - 1] += drift;
    return parts;
  }

  function splitInts(total: number, n: number): number[] {
    if (n <= 0) return [];
    const raw = splitExact(total, n);
    const out = raw.map((v) => Math.floor(v));
    let remainder = total - out.reduce((x, y) => x + y, 0);
    for (let i = 0; remainder > 0; i = (i + 1) % n, remainder--) out[i] += 1;
    return out;
  }

  const RECENT = 7;
  const OLDER = HISTORY_DAYS - RECENT;

  for (const a of REAL_AD_SETS) {
    const cityRowId = a.cityId ? realCityToRowId.get(a.cityId) : undefined;
    if (!cityRowId || a.spend <= 0) continue;

    const spendRecent = a.spend7d;
    const spendOlder = Math.max(0, a.spend - spendRecent);
    const resultsRecent = Math.min(a.results, a.results7d);
    const resultsOlder = Math.max(0, a.results - resultsRecent);

    const spendSeries = [...splitExact(spendOlder, OLDER), ...splitExact(spendRecent, RECENT)];
    const resultSeries = [...splitInts(resultsOlder, OLDER), ...splitInts(resultsRecent, RECENT)];
    const totalSpend = spendSeries.reduce((x, y) => x + y, 0);

    for (let idx = 0; idx < HISTORY_DAYS; idx++) {
      const date = new Date(TODAY.getTime() - (HISTORY_DAYS - 1 - idx) * DAY);
      const share = totalSpend > 0 ? spendSeries[idx] / totalSpend : 0;
      const dayLeads = resultSeries[idx];

      perfRows.push({
        id: newId("perf"),
        date,
        campaignId: a.campaignId,
        adSetId: a.id,
        cityId: cityRowId,
        spend: spendSeries[idx],
        impressions: Math.round(a.impressions * share),
        clicks: Math.round(a.clicks * share),
        leads: dayLeads,
        resultType: a.resultType,
        attributionSetting: a.attributionSetting,
        reach: Math.round(a.reach * share),
        frequency: idx >= OLDER && a.frequency7d > 0 ? a.frequency7d : a.frequency,
      });

      // Lead-quality funnel. Only PIXEL_LEAD and LEAD_FORM ad sets produce CRM
      // records; a WhatsApp conversation is not a lead row and must not be
      // counted as one.
      if (a.resultType === "MESSAGING") continue;
      for (let l = 0; l < dayLeads; l++) {
        const validRate = 0.85;
        const qualifiedRate = a.costPerResult > 110 ? 0.42 : a.costPerResult > 80 ? 0.5 : 0.58;
        const soldRate = 0.22;
        let stage: LeadStage = "LEAD";
        if (Math.random() < validRate) {
          stage = "VALID";
          if (Math.random() < qualifiedRate) {
            stage = "QUALIFIED";
            if (Math.random() < soldRate) stage = "SOLD";
          }
        } else {
          stage = Math.random() < 0.5 ? "INVALID" : "LEAD";
        }
        leadRows.push({
          id: newId("lead"),
          campaignId: a.campaignId,
          cityId: cityRowId,
          stage,
          source: a.resultType === "LEAD_FORM" ? "Meta Lead Form" : "Website Form",
          createdAt: new Date(date.getTime() + randInt(0, 23) * 60 * 60 * 1000),
        });
      }
    }
  }

  console.log(`Inserting ${perfRows.length} performance rows...`);
  for (let i = 0; i < perfRows.length; i += 800) {
    await db.insert(performanceDaily).values(perfRows.slice(i, i + 800));
  }

  console.log(`Inserting ${leadRows.length} lead rows...`);
  for (let i = 0; i < leadRows.length; i += 800) {
    await db.insert(leads).values(leadRows.slice(i, i + 800));
  }

  // -------------------------------------------------------------------
  // Vehicle-level spend/leads (denormalized, Pareto-distributed per city)
  // -------------------------------------------------------------------
  console.log("Distributing spend across vehicles...");
  // City totals come from the real performance rows we just built, so the
  // per-vehicle split is a synthetic breakdown of a real number rather than a
  // synthetic number. Replace this whole block once a catalogue feed lands.
  const cityTotals = new Map<string, { spend: number; leads: number }>();
  for (const row of perfRows) {
    const bucket = cityTotals.get(row.cityId) ?? { spend: 0, leads: 0 };
    bucket.spend += row.spend;
    bucket.leads += row.leads;
    cityTotals.set(row.cityId, bucket);
  }

  for (const profile of CITY_PROFILES) {
    const cityId = cityRecords[profile.name].id;
    const cityVehicles = await db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.cityId, cityId), eq(vehicles.availability, "ACTIVE")));
    const citySpendTotal = cityTotals.get(cityId)?.spend ?? 0;
    const cityLeadsTotal = cityTotals.get(cityId)?.leads ?? 0;

    const weights = cityVehicles.map(() => paretoWeight());
    const weightSum = weights.reduce((a, b) => a + b, 0) || 1;

    const noLeadCandidates = new Set<number>();
    const noLeadTargetCount = Math.round(cityVehicles.length * 0.1);
    while (noLeadCandidates.size < noLeadTargetCount) {
      noLeadCandidates.add(randInt(0, cityVehicles.length - 1));
    }

    const updates = cityVehicles.map((v, idx) => {
      const share = weights[idx] / weightSum;
      let spend = Math.round(citySpendTotal * share);
      let leads = Math.round(cityLeadsTotal * share * randBetween(0.7, 1.3));
      const impressions = Math.max(200, Math.round((spend / randBetween(9, 15)) / (randBetween(1.2, 2.8) / 100)));
      const clicks = Math.max(5, Math.round(impressions * (randBetween(1.2, 2.8) / 100)));

      if (noLeadCandidates.has(idx) && spend > 400) leads = 0;
      if (spend < 150) leads = 0;

      const inventoryAgeDays = Math.floor((TODAY.getTime() - v.listedAt.getTime()) / DAY);
      const perfScore = vehiclePerformanceScore(
        {
          vehicleId: v.id,
          vehicleCode: v.vehicleCode,
          label: `${v.make} ${v.model}`,
          cityName: profile.name,
          spend,
          impressions,
          clicks,
          leads,
          ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
          cpl: leads > 0 ? spend / leads : 0,
          inventoryAgeDays,
          price: v.price,
          cityAvgPrice: v.price,
          availability: "ACTIVE",
        },
        profile.targetCpl
      );
      const healthScore = inventoryHealthScore({
        availability: "ACTIVE",
        inventoryAgeDays,
        hasRecentPriceChange: !!v.previousPrice,
        spend,
        leads,
        hasImages: true,
      });

      return { id: v.id, spend, impressions, clicks, leads, performanceScore: perfScore, healthScore };
    });

    for (const u of updates) {
      await db
        .update(vehicles)
        .set({
          spend: u.spend,
          impressions: u.impressions,
          clicks: u.clicks,
          leads: u.leads,
          performanceScore: u.performanceScore,
          healthScore: u.healthScore,
        })
        .where(eq(vehicles.id, u.id));
    }
  }

  // Flag 3 sold vehicles across the network as "still spending" to trigger Rule 3.
  const soldVehicles = await db.select().from(vehicles).where(eq(vehicles.availability, "SOLD")).limit(3);
  for (const v of soldVehicles) {
    await db
      .update(vehicles)
      .set({ spend: randInt(300, 900), impressions: randInt(4000, 9000), clicks: randInt(40, 120), leads: 0 })
      .where(eq(vehicles.id, v.id));
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
