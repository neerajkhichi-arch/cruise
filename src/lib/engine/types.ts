import type { AudienceSource, AttributionSetting, FunnelStage, ResultType } from "./classify";

/**
 * One comparable slice of cost. A city's spend splits across several of these
 * and they must never be added together into a single "CPL" — a WhatsApp
 * conversation and a website lead are different units, and a 1d_click window
 * and a 1d_view_7d_click window count different things.
 */
export interface CostSegment {
  resultType: ResultType;
  attributionSetting: AttributionSetting;
  stage: FunnelStage;
  /** Human label, e.g. "Website lead · 1d_click · Remarketing". */
  label: string;
  spend: number;
  results: number;
  costPerResult: number;
  spend7d: number;
  results7d: number;
  costPerResult7d: number;
  /** Percentage change of costPerResult, 7d vs 30d. Positive = getting worse. */
  trendPct: number;
}

export interface AdSetMetrics {
  adSetId: string;
  campaignId: string;
  name: string;
  status: "ACTIVE" | "PAUSED";
  cityId: string | null;
  cityName: string | null;
  stage: FunnelStage;
  /** Finer than stage: BROAD / LOOKALIKE / REMARKETING, all from settings. */
  audienceSource: AudienceSource;
  lookalikeSource: string | null;
  catalogueName: string | null;
  productSetName: string | null;
  /** Vehicles in the bound product set — the real inventory for this ad set. */
  productCount: number;
  resultType: ResultType;
  attributionSetting: AttributionSetting;
  /** Cohort key — only compare costPerResult within an identical value. */
  cohort: string;
  hasGeoGuardrail: boolean;
  customAudiences: string[];
  interests: string[];
  ageMin: number;
  ageMax: number;
  genders: number[];
  advantageAudience: boolean;
  dailyBudget: number;
  spend: number;
  results: number;
  costPerResult: number;
  spend7d: number;
  results7d: number;
  costPerResult7d: number;
  frequency: number;
  frequency7d: number;
  reach: number;
  ctr: number;
}

export interface CityMetrics {
  cityId: string;
  cityName: string;
  state: string;
  inventoryTotal: number;
  inventoryActive: number;
  inventoryNew7d: number;
  inventoryOld60d: number;
  avgPrice: number;
  spend: number;
  leads: number;
  qualifiedLeads: number;
  sales: number;
  /**
   * Cost per result of the city's DOMINANT cohort only — the cohort carrying
   * the most spend — not a blend across result types or attribution windows.
   * Read it together with `primaryCohortLabel`, and use `segments` for the
   * full picture. Before 2026-09-01 this was a blended figure; that number was
   * meaningless in an account mixing website leads, WhatsApp conversations and
   * lead forms across four attribution windows.
   */
  cpl: number;
  primaryCohortLabel: string;
  /** Share of the city's spend sitting in the dominant cohort, 0-1. */
  primaryCohortSpendShare: number;
  /** Every comparable slice of this city's spend, largest first. */
  segments: CostSegment[];
  cpql: number;
  ctr: number;
  cpc: number;
  conversionRate: number;
  wowCplChange: number; // percentage, positive = worse (CPL up)
  wowInventoryChange: number; // percentage
  wowCpcChange: number;
  wowCtrChange: number;
  dailyBudget: number;
  targetCpl: number;
}

export interface VehicleMetrics {
  vehicleId: string;
  vehicleCode: string;
  label: string; // "Hyundai Creta VX 2022"
  cityName: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  ctr: number;
  cpl: number;
  inventoryAgeDays: number;
  price: number;
  cityAvgPrice: number;
  availability: "ACTIVE" | "SOLD" | "RESERVED";
  performanceScore: number;
  healthScore: number;
}

export interface CampaignMetrics {
  campaignId: string;
  name: string;
  status: string;
  cities: string[];
  /** Derived from ad set settings, never from `name`. */
  stage: FunnelStage | "MIXED";
  /**
   * Whether this campaign is actually running, as opposed to merely switched on.
   *
   * Meta's `status` is only the campaign's own toggle. A campaign can sit at
   * ACTIVE for years with every ad set beneath it paused - Ads Manager shows
   * those as not delivering, this app showed them as ACTIVE, and a filter for
   * "active campaigns" returned hundreds of 2021 campaigns with no spend.
   *
   *   DELIVERING       on, has a live ad set, and served in this range
   *   NO_DELIVERY      on with a live ad set, but nothing served in the range
   *   NO_ACTIVE_ADSETS on, and nothing beneath it is running
   *   OFF              the campaign itself is paused, archived or deleted
   */
  delivery?: "DELIVERING" | "NO_DELIVERY" | "NO_ACTIVE_ADSETS" | "OFF";
  /** Ad sets under this campaign whose effective status is ACTIVE. */
  activeAdSets?: number;
  resultType: ResultType;
  /**
   * The Meta action_type this campaign's results were counted from.
   *
   * Carried so a figure can be checked against Ads Manager. A result count is
   * only meaningful alongside what was counted: 0 against leadgen.other and 0
   * against a custom pixel event mean quite different things, and for a while
   * every campaign here was counted against one account-wide event regardless
   * of what it optimised for. Null on the seeded platform tables, which have
   * no Meta action behind them.
   */
  resultAction?: string | null;
  attributionSetting: AttributionSetting;
  cohort: string;
  dailyBudget: number;
  totalBudget: number;
  spend: number;
  leads: number;
  cpl: number;
  ctr: number;
  cpc: number;
  /** Cost per thousand impressions — what the auction charged for reach. */
  cpm: number;
  impressions: number;
  clicks: number;
  /**
   * Clicks that left for the destination, rather than every click on the ad.
   *
   * The denominator for click-to-result: `clicks` includes reactions, comments
   * and profile taps, none of which could have become a lead.
   */
  linkClicks?: number;
  reach: number;
  frequency: number;
  targetCpl: number;
  inventoryCount: number;
  daysRunning: number;
  /** Which window these figures cover, so a ₹0 row is legible rather than alarming. */
  window: MetricWindow | MetricRange;
}

/**
 * Campaign metrics were previously always a 7-day read. That made every
 * campaign paused more than a week ago show ₹0 spend and 0 leads, which reads
 * as a broken row rather than as "this stopped running". The window is now
 * explicit and selectable.
 */
export type MetricWindow = "7d" | "30d";

/**
 * The range a metric was measured over, carried alongside the numbers.
 *
 * A metric without its window is not interpretable — 693 leads is excellent
 * over a week and poor over a quarter — and the window is also what has to
 * match Ads Manager for the two to agree.
 */
export interface MetricRange {
  since: string;
  until: string;
}

export interface GeneratedRecommendation {
  scope: "CAMPAIGN" | "CITY" | "VEHICLE" | "ACCOUNT";
  title: string;
  reasons: string[];
  recommendedAction: string;
  impactEstimate?: string;
  /** Cohort the recommendation's evidence sits in, so the reader can check it. */
  evidenceCohort?: string;
  adSetId?: string;
  cityId?: string;
  campaignId?: string;
  vehicleId?: string;
  suggestedDailyBudget?: number;
}

/**
 * A city only belongs in a performance ranking once it has actually delivered.
 * Without this, a city launched minutes ago sorts to the top of a CPL leaderboard
 * at ₹0 and gets recommended as the place to shift budget into.
 */
export function hasRankableDelivery(c: { spend: number; leads: number }): boolean {
  return c.spend > 0 && c.leads > 0;
}
