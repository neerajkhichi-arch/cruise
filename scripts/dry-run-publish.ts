/**
 * Dry run of the live publish path.
 *
 * The blueprint below is not invented and not a fixture: every field was read
 * off ad account 10153410655459601 on 2026-09-02 — campaign 52556591831210
 * (AHM_14TH_Aug_Consolidated), ad set 52556591831410 (Combined Aud.Catalogue),
 * its creative, and custom audience 6901982704154. Running this prints the
 * exact Graph API calls the live path would send, so they can be read against
 * Ads Manager before anything is created.
 */

import { buildPublishPlan, executePlan, type PublishTarget } from "../src/lib/meta/publish";
import type { SourceBlueprint } from "../src/lib/meta/blueprint";

const AHMEDABAD_BLUEPRINT: SourceBlueprint = {
  campaign: {
    id: "52556591831210",
    name: "AHM_14TH_Aug_Consolidated",
    objective: "OUTCOME_LEADS",
    bidStrategy: "LOWEST_COST_WITHOUT_CAP",
    dailyBudget: 2500,
  },
  adSet: {
    id: "52556591831410",
    name: "Combined Aud.Catalogue",
    optimizationGoal: "OFFSITE_CONVERSIONS",
    billingEvent: "IMPRESSIONS",
    // Read verbatim. There is no custom conversion on this account, so this
    // cannot be reconstructed from our own constants.
    promotedObject: { pixel_id: "504049566421102", custom_event_type: "OTHER" },
    attributionSetting: "1d_click",
    // The shape Meta actually returns and accepts. It is sent verbatim, because
    // omitting it makes Meta apply its own 7-day-click default and the setting
    // cannot be changed after the ad set is published.
    attributionSpec: [{ event_type: "CLICK_THROUGH", window_days: 1 }],
    targetingTemplate: {
      genders: [1],
      age_min: 24,
      age_max: 65,
      targeting_optimization: "expansion_all",
      brand_safety_content_filter_levels: ["FACEBOOK_RELAXED", "AN_RELAXED", "FEED_RELAXED"],
      targeting_relaxation_types: { lookalike: 0, custom_audience: 1 },
      targeting_automation: { advantage_audience: 1 },
    },
    sourceCityName: "Ahmedabad",
    sourceCityKey: "1015741",
  },
  pvAudience: {
    id: "6901982704154",
    name: "CD-FB-Buy Used Car-PV-ahmedabad-90Days-New",
    rule: JSON.stringify({
      inclusions: {
        operator: "or",
        rules: [
          {
            event_sources: [{ type: "pixel", id: 504049566421102 }],
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
    retentionDays: 90,
    cityField: "City_Name_New",
    cityValue: "ahmedabad",
  },
  creative: {
    pageId: "179167414600",
    instagramUserId: "17841401516796675",
    productSetId: "920169403676035",
    title: "{{vehicle.title}} {{vehicle.price strip_zeros}}",
    body: "595+ used cars to choose from in Ahmedabad! 🚘 Explore popular models from brands like Hyundai, Mahindra, Toyota, Honda, Tata and more",
    callToActionType: "GET_QUOTE",
    linkUrl: "https://www.cardekho.com/used-cars",
  },
};

async function main() {
  const target: PublishTarget = {
    cityName: process.argv[2] ?? "Lucknow",
    // Meta's own key. In the app this comes from search?type=adgeolocation;
    // here it is passed in so the dry run needs no token.
    geoKey: process.argv[3] ?? "1024600",
    productSetId: process.argv[4] ?? "<product set to be created in Commerce Manager>",
    productCount: Number(process.argv[5] ?? 688),
    dailyBudget: Number(process.argv[6] ?? 1600),
    cplCeiling: Number(process.argv[7] ?? 108),
    existingPvAudienceId: null,
  };

  const plan = buildPublishPlan("10153410655459601", AHMEDABAD_BLUEPRINT, target, {
    activate: true,
    mode: "DRY_RUN",
  });
  const result = await executePlan(plan, "DRY_RUN");

  console.log(`\n=== DRY RUN · ${target.cityName} · nothing was sent ===\n`);
  if (plan.blockers.length) {
    console.log("BLOCKED:");
    plan.blockers.forEach((b) => console.log("  ✗ " + b));
    console.log("");
  }
  for (const n of plan.notes) console.log("• " + n);
  console.log("");
  for (const call of result.results) {
    console.log(`--- step ${call.step}: ${call.label}`);
    console.log(`${call.method} ${call.path}`);
    console.log(JSON.stringify(call.payload, null, 2));
    console.log("");
  }
  process.exit(0);
}

main();
