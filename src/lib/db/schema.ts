// -----------------------------------------------------------------------
// Data model — Drizzle ORM, PostgreSQL.
// -----------------------------------------------------------------------
// Ported from SQLite on 2026-09-17. SQLite was never going to survive the
// move to Vercel: the filesystem there is read-only and thrown away between
// requests, so every user, setting and connected account would have vanished
// between one page load and the next.
//
// The mechanical parts of the port, recorded because the same traps catch
// every SQLite-to-Postgres move:
//
//   - `real` became `doublePrecision`. Money and rates are stored as floats
//     here for continuity with the old data; if this ever has to reconcile
//     against invoices, budgets should become `numeric`.
//   - integer-as-timestamp became a real `timestamp with time zone`. SQLite was
//     storing unix seconds and Drizzle was converting on the way in and out,
//     which worked and told you nothing about the zone. The account runs in
//     Asia/Kolkata and the server will not, so the zone is now explicit.
//   - integer-as-boolean became `boolean`.
//   - `meta_accounts` is a real table here. It used to be created at runtime
//     with CREATE TABLE IF NOT EXISTS because there was no migration step; on
//     Postgres that is neither necessary nor safe under concurrency.
// -----------------------------------------------------------------------
import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["ADMIN", "MANAGER", "VIEWER"] }).notNull().default("VIEWER"),
  avatarColor: text("avatar_color").notNull().default("#1a73e8"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------
// The Meta ad accounts this install works with.
//
// Was a runtime CREATE TABLE against SQLite. Now a real table, because a
// schema that materialises itself on first read cannot be reasoned about and
// races two cold starts against each other.
// -----------------------------------------------------------------------
export const metaAccounts = pgTable("meta_accounts", {
  /** Numeric ad account id, without the `act_` prefix. */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  businessName: text("business_name"),
  /** Catalogue campaigns only. Null means this is not a catalogue account. */
  catalogueId: text("catalogue_id"),
  /** The pixel event counted as a lead. Null falls back to META_CONVERSION_EVENT. */
  conversionEvent: text("conversion_event"),
  /** Published CSV of monthly lead targets and budgets. Null disables auto-pause. */
  leadTargetsCsvUrl: text("lead_targets_csv_url"),
  /** Rupees per day a single campaign may be given. Null falls back to the env cap. */
  maxDailyBudget: doublePrecision("max_daily_budget"),
  isDefault: boolean("is_default").notNull().default(false),
  /**
   * Who this account belongs to, in the operator's words — "CarDekho", or a
   * client's name. Shown wherever an account is named, because on a platform
   * carrying several businesses' accounts, an id is not enough to tell them
   * apart at a glance.
   */
  clientName: text("client_name"),
  /**
   * An access token for THIS account, when it does not come from the shared
   * system user. Null means use the install's system-user token.
   *
   * Encrypted at rest — see lib/crypto.ts. Nothing decrypts it except the
   * credential resolver, and it is never returned to the browser. This column
   * is the seam that lets per-client OAuth arrive later without touching a
   * single Graph call.
   */
  accessTokenEncrypted: text("access_token_encrypted"),
  /** When a per-account token stops working, if Meta stated an expiry. */
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------
// Which people may see which ad accounts.
//
// A row here is a grant. No row is no access, for everyone except an ADMIN —
// so adding a user gives them nothing until someone decides what they should
// see, rather than handing a new joiner every client's spend by default.
//
// Enforced in the server, not the interface. A picker that hides an account
// is a courtesy; the check that matters happens where the account id is
// resolved, because the id can also arrive in a query string.
// -----------------------------------------------------------------------
export const userAccounts = pgTable(
  "user_accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => metaAccounts.id, { onDelete: "cascade" }),
    /**
     * Whether this person may change anything in this account. A MANAGER with
     * a read-only grant can report on it and cannot publish into it, which is
     * the normal shape for a client who wants visibility without control.
     */
    canEdit: boolean("can_edit").notNull().default(false),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    grantedById: text("granted_by_id").references(() => users.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.accountId] }),
    userIdx: index("user_accounts_user_idx").on(t.userId),
  })
);

export const cities = pgTable("cities", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  state: text("state").notNull(),
  tier: text("tier").notNull().default("Tier 1"),
  status: text("status", { enum: ["HEALTHY", "ATTENTION", "CRITICAL"] }).notNull().default("HEALTHY"),
  dailyBudget: doublePrecision("daily_budget").notNull().default(0),
  recommendedBudget: doublePrecision("recommended_budget").notNull().default(0),
  targetCpl: doublePrecision("target_cpl").notNull().default(80),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vehicles = pgTable(
  "vehicles",
  {
    id: text("id").primaryKey(),
    vehicleCode: text("vehicle_code").notNull().unique(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    variant: text("variant").notNull(),
    year: integer("year").notNull(),
    price: doublePrecision("price").notNull(),
    previousPrice: doublePrecision("previous_price"),
    fuel: text("fuel").notNull(),
    transmission: text("transmission").notNull(),
    kmDriven: integer("km_driven").notNull(),
    cityId: text("city_id").notNull().references(() => cities.id),
    dealer: text("dealer").notNull(),
    images: text("images").notNull(),
    vehicleUrl: text("vehicle_url").notNull(),
    availability: text("availability", { enum: ["ACTIVE", "SOLD", "RESERVED"] }).notNull().default("ACTIVE"),
    listedAt: timestamp("listed_at", { withTimezone: true }).notNull(),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    healthScore: integer("health_score").notNull().default(70),
    performanceScore: integer("performance_score").notNull().default(50),
    spend: doublePrecision("spend").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    cityIdx: index("vehicles_city_idx").on(t.cityId),
    availabilityIdx: index("vehicles_availability_idx").on(t.availability),
  })
);

export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  objective: text("objective", { enum: ["LEADS", "WHATSAPP_LEADS", "WEBSITE_LEADS"] }).notNull().default("LEADS"),
  status: text("status", { enum: ["ACTIVE", "PAUSED", "DRAFT", "COMPLETED"] }).notNull().default("ACTIVE"),
  structureType: text("structure_type", { enum: ["DEDICATED_CITY", "STANDARD_CITY", "CITY_CLUSTER"] })
    .notNull()
    .default("STANDARD_CITY"),
  audienceType: text("audience_type", { enum: ["BROAD", "LOOKALIKE", "RETARGETING", "CUSTOM"] })
    .notNull()
    .default("BROAD"),
  inventoryFilter: text("inventory_filter").notNull(),
  dailyBudget: doublePrecision("daily_budget").notNull(),
  totalBudget: doublePrecision("total_budget").notNull(),
  targetCpl: doublePrecision("target_cpl").notNull(),
  catalogueName: text("catalogue_name").notNull().default("UsedCars-Master-Catalogue"),
  performanceScore: integer("performance_score").notNull().default(50),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const campaignCities = pgTable(
  "campaign_cities",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    cityId: text("city_id").notNull().references(() => cities.id),
    budgetShare: doublePrecision("budget_share").notNull().default(0),
  },
  (t) => ({
    uniq: uniqueIndex("campaign_city_uniq").on(t.campaignId, t.cityId),
  })
);

// -----------------------------------------------------------------------
// Ad sets — where delivery settings actually live.
//
// The previous model stopped at campaign level and inferred audience type from
// the campaign name, which is wrong in the live account (see
// src/lib/engine/classify.ts for the specific counter-examples). Funnel stage,
// geo and comparability are all derived from THESE columns.
// -----------------------------------------------------------------------
export const adSets = pgTable(
  "ad_sets",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    /** Nullable: some live ad sets carry no geo constraint at all. */
    cityId: text("city_id").references(() => cities.id),
    name: text("name").notNull(),
    status: text("status", { enum: ["ACTIVE", "PAUSED"] }).notNull().default("PAUSED"),
    optimizationGoal: text("optimization_goal").notNull(),
    /** Never compare cost-per-result across differing values of these two. */
    resultType: text("result_type", { enum: ["PIXEL_LEAD", "MESSAGING", "LEAD_FORM"] }).notNull(),
    attributionSetting: text("attribution_setting", {
      enum: ["1d_click", "1d_view_7d_click", "7d_click_1d_ev", "1d_view_7d_click_1d_ev"],
    }).notNull(),
    /** JSON string arrays, mirroring the Meta targeting spec. */
    geoCities: text("geo_cities").notNull().default("[]"),
    geoRegions: text("geo_regions").notNull().default("[]"),
    customAudiences: text("custom_audiences").notNull().default("[]"),
    /**
     * Seed audience for a lookalike, e.g. "Ahmedabad, Nashik". Null for broad
     * and for remarketing. Without this column a lookalike and a broad ad set
     * are identical in the data — both carry no custom audience — and the only
     * thing separating them is the name, which this codebase does not trust.
     */
    lookalikeSource: text("lookalike_source"),
    /**
     * Catalogue binding. A catalogue ad cannot deliver without both of these,
     * so they are stored on the ad set — which is where Meta binds them — and
     * the launch flow refuses to proceed without them.
     */
    catalogueId: text("catalogue_id"),
    catalogueName: text("catalogue_name"),
    productSetId: text("product_set_id"),
    productSetName: text("product_set_name"),
    /** Meta filter rule JSON, e.g. {"city":{"eq":"nashik"}}. */
    productSetFilter: text("product_set_filter"),
    /** Items in the product set — the real inventory number for this city. */
    productCount: integer("product_count").notNull().default(0),
    excludedAudiences: text("excluded_audiences").notNull().default("[]"),
    interests: text("interests").notNull().default("[]"),
    ageMin: integer("age_min").notNull().default(18),
    ageMax: integer("age_max").notNull().default(65),
    /** JSON array; [] means all genders. */
    genders: text("genders").notNull().default("[]"),
    advantageAudience: boolean("advantage_audience").notNull().default(false),
    targetingOptimization: text("targeting_optimization"),
    dailyBudget: doublePrecision("daily_budget").notNull().default(0),
    spend: doublePrecision("spend").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    reach: integer("reach").notNull().default(0),
    frequency: doublePrecision("frequency").notNull().default(0),
    results: integer("results").notNull().default(0),
    costPerResult: doublePrecision("cost_per_result").notNull().default(0),
    /** Trailing-7-day figures, so decay is visible against the 30-day average. */
    spend7d: doublePrecision("spend_7d").notNull().default(0),
    results7d: integer("results_7d").notNull().default(0),
    costPerResult7d: doublePrecision("cost_per_result_7d").notNull().default(0),
    frequency7d: doublePrecision("frequency_7d").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index("adsets_campaign_idx").on(t.campaignId),
    cityIdx: index("adsets_city_idx").on(t.cityId),
    cohortIdx: index("adsets_cohort_idx").on(t.resultType, t.attributionSetting),
  })
);

export const performanceDaily = pgTable(
  "performance_daily",
  {
    id: text("id").primaryKey(),
    date: timestamp("date", { withTimezone: true }).notNull(),
    campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    adSetId: text("ad_set_id").references(() => adSets.id, { onDelete: "cascade" }),
    cityId: text("city_id").notNull().references(() => cities.id),
    spend: doublePrecision("spend").notNull(),
    impressions: integer("impressions").notNull(),
    clicks: integer("clicks").notNull(),
    /** Raw count of whatever `resultType` names — NOT comparable across types. */
    leads: integer("leads").notNull(),
    resultType: text("result_type", { enum: ["PIXEL_LEAD", "MESSAGING", "LEAD_FORM"] })
      .notNull()
      .default("PIXEL_LEAD"),
    attributionSetting: text("attribution_setting", {
      enum: ["1d_click", "1d_view_7d_click", "7d_click_1d_ev", "1d_view_7d_click_1d_ev"],
    })
      .notNull()
      .default("1d_click"),
    reach: integer("reach").notNull().default(0),
    frequency: doublePrecision("frequency").notNull(),
  },
  (t) => ({
    campaignDateIdx: index("perf_campaign_date_idx").on(t.campaignId, t.date),
    cityDateIdx: index("perf_city_date_idx").on(t.cityId, t.date),
  })
);

export const leads = pgTable(
  "leads",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    cityId: text("city_id").notNull().references(() => cities.id),
    vehicleId: text("vehicle_id").references(() => vehicles.id),
    stage: text("stage", { enum: ["LEAD", "VALID", "QUALIFIED", "SOLD", "INVALID"] }).notNull().default("LEAD"),
    source: text("source").notNull().default("Meta Lead Form"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    cityIdx: index("leads_city_idx").on(t.cityId),
    campaignIdx: index("leads_campaign_idx").on(t.campaignId),
  })
);

export const optimisationRules = pgTable("optimisation_rules", {
  id: text("id").primaryKey(),
  type: text("type", {
    enum: [
      "REDUCE_BUDGET_HIGH_CPL",
      "INCREASE_BUDGET_LOW_CPL",
      "DEACTIVATE_SOLD_VEHICLE",
      "FLAG_NO_LEAD_VEHICLE",
      "LOW_INVENTORY_WARNING",
      "UNDERFUNDED_WINNER",
      "GEO_SELF_COMPETITION",
      "AUDIENCE_EXHAUSTION",
      "UNCONTROLLED_TEST_VARIABLE",
    ],
  })
    .notNull()
    .unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  params: text("params").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recommendations = pgTable("recommendations", {
  id: text("id").primaryKey(),
  source: text("source", { enum: ["RULE", "AI"] }).notNull().default("AI"),
  ruleType: text("rule_type"),
  scope: text("scope", { enum: ["CAMPAIGN", "CITY", "VEHICLE", "ACCOUNT", "ADSET"] }).notNull(),
  title: text("title").notNull(),
  reasons: text("reasons").notNull(),
  recommendedAction: text("recommended_action").notNull(),
  impactEstimate: text("impact_estimate"),
  suggestedDailyBudget: doublePrecision("suggested_daily_budget"),
  status: text("status", { enum: ["PENDING", "APPROVED", "REJECTED"] }).notNull().default("PENDING"),
  cityId: text("city_id").references(() => cities.id),
  campaignId: text("campaign_id").references(() => campaigns.id),
  vehicleId: text("vehicle_id").references(() => vehicles.id),
  dedupeKey: text("dedupe_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedById: text("resolved_by_id").references(() => users.id),
});

export const alerts = pgTable("alerts", {
  id: text("id").primaryKey(),
  type: text("type", {
    enum: [
      "CPL_SPIKE",
      "CPL_IMPROVEMENT",
      "INVENTORY_SHORTAGE",
      "OVERSPEND",
      "SOLD_VEHICLE_ACTIVE",
      "CREATIVE_FATIGUE",
      "HIGH_PERFORMING_CITY",
      "GEO_OVERLAP",
      "AUDIENCE_EXHAUSTION",
    ],
  }).notNull(),
  severity: text("severity", { enum: ["CRITICAL", "WARNING", "SUCCESS"] }).notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  cityId: text("city_id").references(() => cities.id),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const metaIntegration = pgTable("meta_integration", {
  id: text("id").primaryKey(),
  connected: boolean("connected").notNull().default(false),
  businessManager: text("business_manager"),
  adAccountId: text("ad_account_id"),
  adAccountName: text("ad_account_name"),
  pageId: text("page_id"),
  pageName: text("page_name"),
  igAccountId: text("ig_account_id"),
  igUsername: text("ig_username"),
  catalogueId: text("catalogue_id"),
  catalogueName: text("catalogue_name"),
  pixelId: text("pixel_id"),
  capiEnabled: boolean("capi_enabled").notNull().default(false),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
});

export const namingConvention = pgTable("naming_convention", {
  id: text("id").primaryKey(),
  template: text("template").notNull().default("UC | META | {OBJECTIVE} | {CITY} | CATALOGUE | {AUDIENCE}"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accountSettings = pgTable("account_settings", {
  id: text("id").primaryKey(),
  companyName: text("company_name").notNull().default("Girnar Motors Retail Group"),
  defaultTargetCpl: doublePrecision("default_target_cpl").notNull().default(80),
  monthlyBudgetCap: doublePrecision("monthly_budget_cap").notNull().default(5000000),
  lowInventoryThreshold: integer("low_inventory_threshold").notNull().default(300),
  oldInventoryDays: integer("old_inventory_days").notNull().default(60),
  avgDealMargin: doublePrecision("avg_deal_margin").notNull().default(25000),
  emailAlerts: boolean("email_alerts").notNull().default(true),
  slackAlerts: boolean("slack_alerts").notNull().default(true),
  whatsappAlerts: boolean("whatsapp_alerts").notNull().default(false),
});

/**
 * What the platform did, and who asked for it.
 *
 * Every write to Meta lands here: who, which account, what, and whether it
 * worked. On a single-operator tool this was optional. With a team sharing one
 * platform across several businesses' ad accounts, "who paused Ahmedabad" has
 * to have an answer that does not depend on anyone remembering.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    userId: text("user_id").references(() => users.id),
    /** Kept alongside the id: a deleted user must not erase their history. */
    userEmail: text("user_email"),
    accountId: text("account_id"),
    action: text("action").notNull(),
    /** What it acted on — a campaign id, an ad set id, a city name. */
    subject: text("subject"),
    detail: text("detail"),
    ok: boolean("ok").notNull().default(true),
  },
  (t) => ({
    atIdx: index("audit_at_idx").on(t.at),
    accountIdx: index("audit_account_idx").on(t.accountId),
  })
);

// ---- relations (used for query-builder `.with` includes) ----------------
export const citiesRelations = relations(cities, ({ many }) => ({
  vehicles: many(vehicles),
  campaignLinks: many(campaignCities),
  adSets: many(adSets),
  performance: many(performanceDaily),
  leads: many(leads),
}));

export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
  city: one(cities, { fields: [vehicles.cityId], references: [cities.id] }),
  leadRecords: many(leads),
}));

export const campaignsRelations = relations(campaigns, ({ many }) => ({
  cities: many(campaignCities),
  adSets: many(adSets),
  performance: many(performanceDaily),
  leads: many(leads),
}));

export const adSetsRelations = relations(adSets, ({ one, many }) => ({
  campaign: one(campaigns, { fields: [adSets.campaignId], references: [campaigns.id] }),
  city: one(cities, { fields: [adSets.cityId], references: [cities.id] }),
  performance: many(performanceDaily),
}));

export const campaignCitiesRelations = relations(campaignCities, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaignCities.campaignId], references: [campaigns.id] }),
  city: one(cities, { fields: [campaignCities.cityId], references: [cities.id] }),
}));

export const leadsRelations = relations(leads, ({ one }) => ({
  campaign: one(campaigns, { fields: [leads.campaignId], references: [campaigns.id] }),
  city: one(cities, { fields: [leads.cityId], references: [cities.id] }),
  vehicle: one(vehicles, { fields: [leads.vehicleId], references: [vehicles.id] }),
}));

export const recommendationsRelations = relations(recommendations, ({ one }) => ({
  city: one(cities, { fields: [recommendations.cityId], references: [cities.id] }),
  campaign: one(campaigns, { fields: [recommendations.campaignId], references: [campaigns.id] }),
  vehicle: one(vehicles, { fields: [recommendations.vehicleId], references: [vehicles.id] }),
  resolvedBy: one(users, { fields: [recommendations.resolvedById], references: [users.id] }),
}));

export const alertsRelations = relations(alerts, ({ one }) => ({
  city: one(cities, { fields: [alerts.cityId], references: [cities.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  accountGrants: many(userAccounts),
}));

export const metaAccountsRelations = relations(metaAccounts, ({ many }) => ({
  grants: many(userAccounts),
}));

export const userAccountsRelations = relations(userAccounts, ({ one }) => ({
  user: one(users, { fields: [userAccounts.userId], references: [users.id] }),
  account: one(metaAccounts, { fields: [userAccounts.accountId], references: [metaAccounts.id] }),
}));
