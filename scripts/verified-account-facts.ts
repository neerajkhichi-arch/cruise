// ---------------------------------------------------------------------------
// Values read off the live ad account, not derived and not invented.
//
// Read on 2026-09-02 from ad account 10153410655459601 ("Used Cars Sales",
// CarDekho business 10153160932409601):
//   - campaign  52556591831210  AHM_14TH_Aug_Consolidated
//   - ad set    52556591831410  Combined Aud.Catalogue
//   - ad set    52561278619610  Consolidated-Mohali
//   - audience  6901982704154   CD-FB-Buy Used Car-PV-ahmedabad-90Days-New
//   - creatives 1592434685763864 / 2552319931860862
//
// These exist so the publish preview is truthful when no access token is
// configured. With a token the app reads the blueprint from the API instead,
// and these become a fallback rather than the source of truth.
// ---------------------------------------------------------------------------

export const ACCOUNT = {
  adAccountId: "10153410655459601",
  adAccountName: "Used Cars Sales",
  businessId: "10153160932409601",
  currency: "INR",
  pixelId: "504049566421102",
  pageId: "179167414600",
  /**
   * The Instagram identity the ads run as — @cardekhoindia, read from
   * act_10153410655459601/instagram_accounts on 2026-09-04.
   *
   * This is an Instagram BUSINESS ACCOUNT id (the 1784… space). It is sent as
   * `instagram_user_id`, the field that replaced `instagram_actor_id` from
   * Marketing API v22.0 onwards — which is why the app talks to v23.0. Sent to
   * the old field it is rejected as "not a valid Instagram account id"; that
   * rejection is about the FIELD, not the id.
   *
   * Required, not optional. The account runs Advantage+ placements, which
   * include Instagram, so Meta refuses the ad with "Instagram account is
   * missing" unless the creative names one. Omitting it does not quietly fall
   * back to the page.
   */
  instagramUserId: "17841401516796675",
  instagramUsername: "cardekhoindia",
} as const;

/**
 * The campaign level. Both live consolidated campaigns are OUTCOME_LEADS with
 * highest-volume bidding and the budget held at campaign level (CBO) — which
 * is why the app's per-ad-set budget split does not describe this account.
 */
export const CAMPAIGN_DEFAULTS = {
  objective: "OUTCOME_LEADS",
  bidStrategy: "LOWEST_COST_WITHOUT_CAP",
  budgetLevel: "CAMPAIGN" as const,
};

/**
 * The conversion event, confirmed in Ads Manager on 2026-09-02:
 *
 *   Conversion location  Website
 *   Performance goal     Maximise number of leads
 *   Dataset              Used Cars Sales's Pixel  (504049566421102)
 *   Conversion event     UCR_Lead_Submit_New
 *
 * This is a CUSTOM pixel event, not a standard one and not a custom
 * conversion — which is why `ads_get_customconversions` came back empty and
 * why the API returns `custom_event_type: "OTHER"` on the live ad sets.
 *
 * For a custom event, "OTHER" alone is not enough: Meta needs
 * `custom_event_str` to know WHICH event. An ad set created without it
 * optimises against nothing in particular while still looking correct in the
 * interface — the most expensive kind of wrong.
 */
export const CONVERSION_EVENT = "UCR_Lead_Submit_New";

export const PROMOTED_OBJECT: Record<string, unknown> = {
  pixel_id: ACCOUNT.pixelId,
  custom_event_type: "OTHER",
  custom_event_str: CONVERSION_EVENT,
};

/**
 * Targeting minus geo and audiences. Every key here was present on the live
 * ad sets; nothing has been added. Placements are omitted deliberately — the
 * account runs Advantage+ placements, and listing the effective ones back
 * would pin them.
 */
export const TARGETING_TEMPLATE: Record<string, unknown> = {
  genders: [1],
  age_min: 24,
  age_max: 65,
  targeting_optimization: "expansion_all",
  brand_safety_content_filter_levels: ["FACEBOOK_RELAXED", "AN_RELAXED", "FEED_RELAXED"],
  targeting_relaxation_types: { lookalike: 0, custom_audience: 1 },
  targeting_automation: { advantage_audience: 1 },
};

export const AD_SET_DEFAULTS = {
  optimizationGoal: "OFFSITE_CONVERSIONS",
  billingEvent: "IMPRESSIONS",
  attributionSetting: "1d_click",
};

/**
 * The Ahmedabad page-visitor audience rule. Cloning a city means swapping the
 * City_Name_New value; everything else is left alone.
 */
export const PV_AUDIENCE = {
  id: "6901982704154",
  name: "CD-FB-Buy Used Car-PV-ahmedabad-90Days-New",
  retentionDays: 90,
  cityField: "City_Name_New",
  cityValue: "ahmedabad",
  rule: JSON.stringify({
    inclusions: {
      operator: "or",
      rules: [
        {
          event_sources: [{ type: "pixel", id: Number(ACCOUNT.pixelId) }],
          retention_seconds: 7776000,
          filter: {
            operator: "and",
            filters: [
              { field: "event", operator: "eq", value: "PageView" },
              { operator: "or", filters: [{ field: "Vehicle_Type_New", operator: "i_contains", value: "usedusedcar" }] },
              { operator: "or", filters: [{ field: "City_Name_New", operator: "i_contains", value: "ahmedabad" }] },
            ],
          },
        },
      ],
    },
  }),
};

/** The dynamic catalogue creative, as it runs today. */
export const CREATIVE_TEMPLATE = {
  pageId: ACCOUNT.pageId,
  instagramUserId: ACCOUNT.instagramUserId,
  title: "{{vehicle.title}} {{vehicle.price strip_zeros}}",
  body: "595+ used cars to choose from in Ahmedabad! 🚘 Explore popular models from brands like Hyundai, Mahindra, Toyota, Honda, Tata and more",
  callToActionType: "GET_QUOTE",
  linkUrl: "https://www.cardekho.com/used-cars",
  sourceCityName: "Ahmedabad",
};

/**
 * Meta city keys observed on live ad sets. Anything not listed is resolved
 * through the geo search at publish time — a guessed key targets the wrong
 * place, so there are no guesses here.
 */
export const KNOWN_GEO_KEYS: Record<string, string> = {
  ahmedabad: "1015741",
  mohali: "1035473",
};
