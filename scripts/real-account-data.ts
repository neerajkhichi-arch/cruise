// ---------------------------------------------------------------------------
// Real account data — pulled from the live Meta account "Used Cars Sales"
// (ad_account_id 10153410655459601, CarDekho) on 2026-09-01, last 30 days.
//
// This file replaces the invented nine-city dataset the earlier build shipped
// with. Every spend, result, frequency and targeting value below came from the
// Marketing API. Nothing here is a plausible-looking guess.
//
// The one dataset that is still synthetic is vehicle inventory: no catalogue
// or product feed is connected yet, so `scripts/seed.ts` still generates
// vehicles. That is called out at its definition and is the next thing to
// replace with a real feed.
// ---------------------------------------------------------------------------

export interface RealCity {
  id: string;
  name: string;
  state: string;
  tier: string;
}

export interface RealCampaign {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED";
  objective: "LEADS" | "WHATSAPP_LEADS" | "WEBSITE_LEADS";
}

export interface RealAdSet {
  id: string;
  campaignId: string;
  cityId: string | null;
  name: string;
  status: "ACTIVE" | "PAUSED";
  optimizationGoal: string;
  resultType: "PIXEL_LEAD" | "MESSAGING" | "LEAD_FORM";
  attributionSetting: "1d_click" | "1d_view_7d_click" | "7d_click_1d_ev" | "1d_view_7d_click_1d_ev";
  geoCities: string[];
  geoRegions: string[];
  customAudiences: string[];
  excludedAudiences: string[];
  interests: string[];
  ageMin: number;
  ageMax: number;
  genders: number[];
  advantageAudience: boolean;
  targetingOptimization: string | null;
  dailyBudget: number;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  frequency: number;
  results: number;
  costPerResult: number;
  spend7d: number;
  results7d: number;
  costPerResult7d: number;
  frequency7d: number;
  startedAt: string | null;
}

export const REAL_CITIES: RealCity[] = [
  {
    "id": "ahmedabad",
    "name": "Ahmedabad",
    "state": "Gujarat",
    "tier": "Tier 1"
  },
  {
    "id": "chandigarh",
    "name": "Chandigarh",
    "state": "Chandigarh",
    "tier": "Tier 2"
  },
  {
    "id": "nashik",
    "name": "Nashik",
    "state": "Maharashtra",
    "tier": "Tier 2"
  },
  {
    "id": "mohali",
    "name": "Mohali",
    "state": "Punjab",
    "tier": "Tier 2"
  },
  {
    "id": "delhi-ncr",
    "name": "Delhi NCR",
    "state": "Delhi",
    "tier": "Tier 1"
  }
];

export const REAL_CAMPAIGNS: RealCampaign[] = [
  {
    "id": "52544798880410",
    "name": "Nashik-Whatsup-Leads -13thJuly",
    "status": "PAUSED",
    "objective": "WHATSAPP_LEADS"
  },
  {
    "id": "6978995493206",
    "name": "Chandigarh-UCR-Catalogue-Ads",
    "status": "PAUSED",
    "objective": "WEBSITE_LEADS"
  },
  {
    "id": "6975717240806",
    "name": "AHM-UCR-Catalogue-Ads",
    "status": "PAUSED",
    "objective": "WEBSITE_LEADS"
  },
  {
    "id": "52556591831210",
    "name": "AHM_14TH_Aug_Consolidated",
    "status": "ACTIVE",
    "objective": "WEBSITE_LEADS"
  },
  {
    "id": "52547558236210",
    "name": "Nashik-VIA-21July-Catalogue",
    "status": "PAUSED",
    "objective": "WEBSITE_LEADS"
  },
  {
    "id": "52557744491810",
    "name": "CHD-17aug-Consolidated",
    "status": "ACTIVE",
    "objective": "WEBSITE_LEADS"
  },
  {
    "id": "52557642264010",
    "name": "Nashik-17aug-Consolidated",
    "status": "ACTIVE",
    "objective": "WEBSITE_LEADS"
  },
  {
    "id": "52549892395810",
    "name": "AHM-VIA-Catalogue-28July",
    "status": "PAUSED",
    "objective": "WEBSITE_LEADS"
  },
  {
    "id": "52549895864410",
    "name": "CHD-VIA-Catalogue-28july",
    "status": "PAUSED",
    "objective": "WEBSITE_LEADS"
  },
  {
    "id": "52552312102010",
    "name": "Chandigarh-Whatsup-Leads-4ug",
    "status": "PAUSED",
    "objective": "WHATSAPP_LEADS"
  },
  {
    "id": "6978992383006",
    "name": "Nashik-UCR-Catalogue-Ads",
    "status": "PAUSED",
    "objective": "WEBSITE_LEADS"
  },
  {
    "id": "52552654518610",
    "name": "AHM-Whatsup-Leads-5aug",
    "status": "PAUSED",
    "objective": "WHATSAPP_LEADS"
  },
  {
    "id": "6652174143006",
    "name": "UCR-Lead-Luxury-Cart-Classified-Jan25",
    "status": "PAUSED",
    "objective": "LEADS"
  },
  {
    "id": "52558000415610",
    "name": "Nashik-Remarketing",
    "status": "ACTIVE",
    "objective": "WEBSITE_LEADS"
  },
  {
    "id": "52559382467810",
    "name": "CHD-Remarketing",
    "status": "ACTIVE",
    "objective": "WEBSITE_LEADS"
  },
  {
    "id": "52561244309610",
    "name": "Mohali-Consolidated-31aug",
    "status": "ACTIVE",
    "objective": "WEBSITE_LEADS"
  },
  {
    "id": "52542505854210",
    "name": "Nashik-Whatsup-Leads",
    "status": "PAUSED",
    "objective": "WHATSAPP_LEADS"
  },
  {
    "id": "52541847400410",
    "name": "Nashik-UCR-Static-Website",
    "status": "PAUSED",
    "objective": "WEBSITE_LEADS"
  }
];

export const REAL_AD_SETS: RealAdSet[] = [
  {
    "id": "52556591831410",
    "campaignId": "52556591831210",
    "cityId": "ahmedabad",
    "name": "Combined Aud.Catalogue",
    "status": "ACTIVE",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_click",
    "geoCities": [
      "Ahmedabad"
    ],
    "geoRegions": [],
    "customAudiences": [
      "CD-FB-Buy Used Car-PV-ahmedabad-90Days-New"
    ],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 24,
    "ageMax": 65,
    "genders": [
      1
    ],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 0.0,
    "spend": 59771.33,
    "impressions": 689097,
    "clicks": 77462,
    "reach": 110171,
    "frequency": 6.25,
    "results": 1857,
    "costPerResult": 32.19,
    "spend7d": 20472.26,
    "results7d": 741,
    "costPerResult7d": 27.63,
    "frequency7d": 4.2,
    "startedAt": "2026-08-14"
  },
  {
    "id": "6975717240406",
    "campaignId": "6975717240806",
    "cityId": "ahmedabad",
    "name": "Ahemdabad-Catalogue-remarketing",
    "status": "PAUSED",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_view_7d_click_1d_ev",
    "geoCities": [
      "Ahmedabad"
    ],
    "geoRegions": [],
    "customAudiences": [
      "CD-FB-Buy Used Car-PV-ahmedabad-90Days-New"
    ],
    "excludedAudiences": [],
    "interests": [
      "Used car (vehicle)"
    ],
    "ageMin": 18,
    "ageMax": 65,
    "genders": [],
    "advantageAudience": true,
    "targetingOptimization": null,
    "dailyBudget": 0.0,
    "spend": 55351.14,
    "impressions": 1282935,
    "clicks": 74629,
    "reach": 398466,
    "frequency": 3.22,
    "results": 601,
    "costPerResult": 92.1,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-04-20"
  },
  {
    "id": "52544798881610",
    "campaignId": "52544798880410",
    "cityId": "nashik",
    "name": "Remarketing",
    "status": "PAUSED",
    "optimizationGoal": "CONVERSATIONS",
    "resultType": "MESSAGING",
    "attributionSetting": "1d_view_7d_click",
    "geoCities": [
      "Nashik"
    ],
    "geoRegions": [],
    "customAudiences": [
      "CD-FB-Buy Used Car-PV-nashik-90Days-New"
    ],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 24,
    "ageMax": 65,
    "genders": [
      1
    ],
    "advantageAudience": true,
    "targetingOptimization": null,
    "dailyBudget": 0.0,
    "spend": 53833.65,
    "impressions": 890955,
    "clicks": 5018,
    "reach": 216969,
    "frequency": 4.11,
    "results": 656,
    "costPerResult": 82.06,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-07-13"
  },
  {
    "id": "52557744492210",
    "campaignId": "52557744491810",
    "cityId": "chandigarh",
    "name": "CHD-Combine-Audiences",
    "status": "ACTIVE",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_click",
    "geoCities": [],
    "geoRegions": [
      "Chandigarh"
    ],
    "customAudiences": [],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 20,
    "ageMax": 65,
    "genders": [
      1
    ],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 0.0,
    "spend": 48529.32,
    "impressions": 579117,
    "clicks": 40963,
    "reach": 141195,
    "frequency": 4.1,
    "results": 478,
    "costPerResult": 101.53,
    "spend7d": 19271.42,
    "results7d": 154,
    "costPerResult7d": 125.14,
    "frequency7d": 2.84,
    "startedAt": "2026-08-17"
  },
  {
    "id": "52557642263610",
    "campaignId": "52557642264010",
    "cityId": "nashik",
    "name": "Combined Aud.Catalogue-nashik",
    "status": "ACTIVE",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_click",
    "geoCities": [
      "Nashik"
    ],
    "geoRegions": [],
    "customAudiences": [],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 24,
    "ageMax": 65,
    "genders": [
      1
    ],
    "advantageAudience": true,
    "targetingOptimization": null,
    "dailyBudget": 0.0,
    "spend": 48253.98,
    "impressions": 726209,
    "clicks": 36268,
    "reach": 157143,
    "frequency": 4.62,
    "results": 598,
    "costPerResult": 80.69,
    "spend7d": 19651.33,
    "results7d": 294,
    "costPerResult7d": 66.84,
    "frequency7d": 3.4,
    "startedAt": "2026-08-17"
  },
  {
    "id": "52540468884610",
    "campaignId": "6978995493206",
    "cityId": "mohali",
    "name": "Chandigarh-Catalogue-Detailed",
    "status": "PAUSED",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_view_7d_click_1d_ev",
    "geoCities": [
      "Mohali"
    ],
    "geoRegions": [
      "Chandigarh"
    ],
    "customAudiences": [],
    "excludedAudiences": [],
    "interests": [
      "Used car (vehicle)"
    ],
    "ageMin": 18,
    "ageMax": 65,
    "genders": [],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 0.0,
    "spend": 41512.09,
    "impressions": 1099298,
    "clicks": 81116,
    "reach": 300812,
    "frequency": 3.65,
    "results": 450,
    "costPerResult": 92.25,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-07-02"
  },
  {
    "id": "52547558237010",
    "campaignId": "52547558236210",
    "cityId": "nashik",
    "name": "Nashik-Remarkting",
    "status": "PAUSED",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_view_7d_click_1d_ev",
    "geoCities": [
      "Nashik"
    ],
    "geoRegions": [],
    "customAudiences": [
      "CD-FB-Buy Used Car-PV-nashik-90Days-New"
    ],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 20,
    "ageMax": 65,
    "genders": [],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 0.0,
    "spend": 31513.08,
    "impressions": 551951,
    "clicks": 22644,
    "reach": 182509,
    "frequency": 3.02,
    "results": 266,
    "costPerResult": 118.47,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-07-21"
  },
  {
    "id": "52552654519410",
    "campaignId": "52552654518610",
    "cityId": null,
    "name": "Remarketing-AHM-Whatsup",
    "status": "PAUSED",
    "optimizationGoal": "CONVERSATIONS",
    "resultType": "MESSAGING",
    "attributionSetting": "1d_view_7d_click",
    "geoCities": [],
    "geoRegions": [],
    "customAudiences": [
      "CD-FB-Buy Used Car-PV-ahmedabad-90Days-New"
    ],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 20,
    "ageMax": 65,
    "genders": [
      1
    ],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 0.0,
    "spend": 29007.31,
    "impressions": 654770,
    "clicks": 5095,
    "reach": 133023,
    "frequency": 4.92,
    "results": 662,
    "costPerResult": 43.82,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-08-05"
  },
  {
    "id": "6978995492806",
    "campaignId": "6978995493206",
    "cityId": "mohali",
    "name": "Chandigarh-Remarketing",
    "status": "PAUSED",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_view_7d_click_1d_ev",
    "geoCities": [
      "Mohali"
    ],
    "geoRegions": [
      "Chandigarh"
    ],
    "customAudiences": [
      "CD-FB-Buy Used Car-PV-Chandigarh-90Days",
      "CD-FB-Buy Used Car-PV-chandigarh-90Days-New"
    ],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 18,
    "ageMax": 65,
    "genders": [],
    "advantageAudience": true,
    "targetingOptimization": null,
    "dailyBudget": 0.0,
    "spend": 26920.3,
    "impressions": 477006,
    "clicks": 26856,
    "reach": 144555,
    "frequency": 3.3,
    "results": 210,
    "costPerResult": 128.19,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-04-22"
  },
  {
    "id": "52549894519610",
    "campaignId": "52549892395810",
    "cityId": "ahmedabad",
    "name": "Ahemdabad-Catalogue-advantage+-12aug",
    "status": "PAUSED",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "7d_click_1d_ev",
    "geoCities": [
      "Ahmedabad"
    ],
    "geoRegions": [],
    "customAudiences": [
      "CD-FB-Buy Used Car-PV-ahmedabad-90Days-New"
    ],
    "excludedAudiences": [],
    "interests": [
      "Used car (vehicle)"
    ],
    "ageMin": 18,
    "ageMax": 65,
    "genders": [
      1
    ],
    "advantageAudience": true,
    "targetingOptimization": null,
    "dailyBudget": 0.0,
    "spend": 26250.49,
    "impressions": 403716,
    "clicks": 25539,
    "reach": 150833,
    "frequency": 2.68,
    "results": 321,
    "costPerResult": 81.78,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-07-28"
  },
  {
    "id": "52549895865210",
    "campaignId": "52549895864410",
    "cityId": "mohali",
    "name": "Chandigarh-Remarketing-dynamic-feed",
    "status": "PAUSED",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_view_7d_click_1d_ev",
    "geoCities": [
      "Mohali"
    ],
    "geoRegions": [
      "Chandigarh"
    ],
    "customAudiences": [
      "CD-FB-Buy Used Car-PV-Chandigarh-90Days",
      "CD-FB-Buy Used Car-PV-chandigarh-90Days-New"
    ],
    "excludedAudiences": [],
    "interests": [
      "Used car (vehicle)"
    ],
    "ageMin": 18,
    "ageMax": 65,
    "genders": [],
    "advantageAudience": false,
    "targetingOptimization": null,
    "dailyBudget": 0.0,
    "spend": 26014.22,
    "impressions": 292405,
    "clicks": 13115,
    "reach": 83962,
    "frequency": 3.48,
    "results": 124,
    "costPerResult": 209.79,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-07-28"
  },
  {
    "id": "52552312102810",
    "campaignId": "52552312102010",
    "cityId": "chandigarh",
    "name": "CHD-Remarketing",
    "status": "PAUSED",
    "optimizationGoal": "CONVERSATIONS",
    "resultType": "MESSAGING",
    "attributionSetting": "1d_view_7d_click",
    "geoCities": [
      "Chandigarh"
    ],
    "geoRegions": [],
    "customAudiences": [],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 24,
    "ageMax": 65,
    "genders": [],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 0.0,
    "spend": 22765.98,
    "impressions": 394206,
    "clicks": 3552,
    "reach": 77925,
    "frequency": 5.06,
    "results": 490,
    "costPerResult": 46.46,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-08-04"
  },
  {
    "id": "52540463453410",
    "campaignId": "6978992383006",
    "cityId": "nashik",
    "name": "Nashik-Catalogue - Detailed-Targeting",
    "status": "ACTIVE",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_view_7d_click_1d_ev",
    "geoCities": [
      "Nashik"
    ],
    "geoRegions": [],
    "customAudiences": [],
    "excludedAudiences": [],
    "interests": [
      "Used car (vehicle)"
    ],
    "ageMin": 24,
    "ageMax": 65,
    "genders": [
      1
    ],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 0.0,
    "spend": 19604.24,
    "impressions": 307143,
    "clicks": 20208,
    "reach": 120632,
    "frequency": 2.55,
    "results": 208,
    "costPerResult": 94.25,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-07-02"
  },
  {
    "id": "52547558236810",
    "campaignId": "52547558236210",
    "cityId": "nashik",
    "name": "Nashik-Catalogue - Detailed-Targeting",
    "status": "PAUSED",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_view_7d_click_1d_ev",
    "geoCities": [
      "Nashik"
    ],
    "geoRegions": [],
    "customAudiences": [],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 20,
    "ageMax": 65,
    "genders": [
      1
    ],
    "advantageAudience": true,
    "targetingOptimization": null,
    "dailyBudget": 0.0,
    "spend": 18816.25,
    "impressions": 271931,
    "clicks": 13055,
    "reach": 109868,
    "frequency": 2.48,
    "results": 237,
    "costPerResult": 79.39,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-07-21"
  },
  {
    "id": "52544798880810",
    "campaignId": "52544798880410",
    "cityId": "nashik",
    "name": "Detailed-Audience",
    "status": "ACTIVE",
    "optimizationGoal": "CONVERSATIONS",
    "resultType": "MESSAGING",
    "attributionSetting": "1d_view_7d_click",
    "geoCities": [
      "Nashik"
    ],
    "geoRegions": [],
    "customAudiences": [],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 25,
    "ageMax": 65,
    "genders": [
      1
    ],
    "advantageAudience": true,
    "targetingOptimization": null,
    "dailyBudget": 0.0,
    "spend": 16519.45,
    "impressions": 493222,
    "clicks": 3727,
    "reach": 183230,
    "frequency": 2.69,
    "results": 238,
    "costPerResult": 69.41,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-07-13"
  },
  {
    "id": "52553574404210",
    "campaignId": "6975717240806",
    "cityId": "ahmedabad",
    "name": "Ahemdabad-Catalogue-detailed",
    "status": "PAUSED",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_view_7d_click_1d_ev",
    "geoCities": [
      "Ahmedabad"
    ],
    "geoRegions": [],
    "customAudiences": [
      "CD-FB-Buy Used Car-PV-ahmedabad-90Days-New"
    ],
    "excludedAudiences": [],
    "interests": [
      "Used car (vehicle)"
    ],
    "ageMin": 20,
    "ageMax": 65,
    "genders": [],
    "advantageAudience": false,
    "targetingOptimization": null,
    "dailyBudget": 0.0,
    "spend": 12923.0,
    "impressions": 335738,
    "clicks": 32269,
    "reach": 145720,
    "frequency": 2.3,
    "results": 177,
    "costPerResult": 73.01,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-08-07"
  },
  {
    "id": "6978992382606",
    "campaignId": "6978992383006",
    "cityId": "nashik",
    "name": "Nashik-Remarkting",
    "status": "PAUSED",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_view_7d_click_1d_ev",
    "geoCities": [
      "Nashik"
    ],
    "geoRegions": [],
    "customAudiences": [
      "CD-FB-Buy Used Car-PV-nashik-90Days-New"
    ],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 23,
    "ageMax": 65,
    "genders": [
      1
    ],
    "advantageAudience": true,
    "targetingOptimization": null,
    "dailyBudget": 0.0,
    "spend": 12174.35,
    "impressions": 210761,
    "clicks": 11541,
    "reach": 81066,
    "frequency": 2.6,
    "results": 109,
    "costPerResult": 111.69,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-04-22"
  },
  {
    "id": "52549892395610",
    "campaignId": "52549892395810",
    "cityId": "ahmedabad",
    "name": "Ahemdabad-Catalogue-Remarketing-28july",
    "status": "PAUSED",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "7d_click_1d_ev",
    "geoCities": [
      "Ahmedabad"
    ],
    "geoRegions": [],
    "customAudiences": [
      "CD-FB-Buy Used Car-PV-ahmedabad-90Days-New"
    ],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 20,
    "ageMax": 65,
    "genders": [],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 0.0,
    "spend": 12167.22,
    "impressions": 163605,
    "clicks": 11457,
    "reach": 70250,
    "frequency": 2.33,
    "results": 142,
    "costPerResult": 85.68,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-07-28"
  },
  {
    "id": "6652174143206",
    "campaignId": "6652174143006",
    "cityId": "delhi-ncr",
    "name": "Luxury-Cart-Classified-Delhi-NCR-LeadForm-PV",
    "status": "ACTIVE",
    "optimizationGoal": "LEAD_GENERATION",
    "resultType": "LEAD_FORM",
    "attributionSetting": "1d_view_7d_click",
    "geoCities": [
      "Delhi"
    ],
    "geoRegions": [],
    "customAudiences": [
      "CD_usedcars_LD_2021_October_FB",
      "usedcarpv-excl-leaddroppers-60days(UCS)-18072022",
      "Lookalike (IN, 1%) - usedcarpv-excl-leaddroppers-30days(UCS)-170122",
      "Lookalike (IN, 1%) - UCR_LeadDroppers_Jan22_Aug22_FB",
      "CarDekho-used-car-audience",
      "CD-Used Car-pan-india-PV-90-Days"
    ],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 25,
    "ageMax": 65,
    "genders": [],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 500.0,
    "spend": 11425.74,
    "impressions": 50113,
    "clicks": 917,
    "reach": 22829,
    "frequency": 2.2,
    "results": 145,
    "costPerResult": 78.8,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2025-01-15"
  },
  {
    "id": "52552312103010",
    "campaignId": "52552312102010",
    "cityId": "nashik",
    "name": "CHD-Detailed-Audience",
    "status": "PAUSED",
    "optimizationGoal": "CONVERSATIONS",
    "resultType": "MESSAGING",
    "attributionSetting": "1d_view_7d_click",
    "geoCities": [
      "Nashik"
    ],
    "geoRegions": [],
    "customAudiences": [],
    "excludedAudiences": [],
    "interests": [
      "Used car (vehicle)"
    ],
    "ageMin": 25,
    "ageMax": 65,
    "genders": [
      1
    ],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 0.0,
    "spend": 10179.35,
    "impressions": 138848,
    "clicks": 1035,
    "reach": 72583,
    "frequency": 1.91,
    "results": 159,
    "costPerResult": 64.02,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-08-04"
  },
  {
    "id": "52558000415810",
    "campaignId": "52558000415610",
    "cityId": "nashik",
    "name": "Rem_Catalogue",
    "status": "ACTIVE",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_click",
    "geoCities": [
      "Nashik"
    ],
    "geoRegions": [],
    "customAudiences": [
      "CD-FB-Buy Used Car-PV-nashik-90Days-New"
    ],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 24,
    "ageMax": 65,
    "genders": [
      1
    ],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 0.0,
    "spend": 9106.84,
    "impressions": 100331,
    "clicks": 5872,
    "reach": 36984,
    "frequency": 2.71,
    "results": 144,
    "costPerResult": 63.24,
    "spend7d": 5637.75,
    "results7d": 82,
    "costPerResult7d": 68.75,
    "frequency7d": 2.36,
    "startedAt": "2026-08-18"
  },
  {
    "id": "52549895864610",
    "campaignId": "52549895864410",
    "cityId": "mohali",
    "name": "Chandigarh-Catalogue-Detailed",
    "status": "PAUSED",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_view_7d_click_1d_ev",
    "geoCities": [
      "Mohali"
    ],
    "geoRegions": [
      "Chandigarh"
    ],
    "customAudiences": [],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 18,
    "ageMax": 65,
    "genders": [
      1
    ],
    "advantageAudience": true,
    "targetingOptimization": null,
    "dailyBudget": 0.0,
    "spend": 8955.4,
    "impressions": 184190,
    "clicks": 9013,
    "reach": 97222,
    "frequency": 1.89,
    "results": 99,
    "costPerResult": 90.46,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-07-28"
  },
  {
    "id": "52555453793010",
    "campaignId": "52547558236210",
    "cityId": "nashik",
    "name": "Test - Nashik-Catalogue - Detailed-Targeting",
    "status": "PAUSED",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_view_7d_click_1d_ev",
    "geoCities": [
      "Nashik"
    ],
    "geoRegions": [],
    "customAudiences": [],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 20,
    "ageMax": 65,
    "genders": [
      1
    ],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 0.0,
    "spend": 7138.1,
    "impressions": 90124,
    "clicks": 4297,
    "reach": 41403,
    "frequency": 2.18,
    "results": 67,
    "costPerResult": 106.54,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-08-12"
  },
  {
    "id": "52559382468010",
    "campaignId": "52559382467810",
    "cityId": "chandigarh",
    "name": "CHD-REM",
    "status": "ACTIVE",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_click",
    "geoCities": [
      "Chandigarh"
    ],
    "geoRegions": [],
    "customAudiences": [
      "CD-FB-Buy Used Car-PV-chandigarh-90Days-New"
    ],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 24,
    "ageMax": 65,
    "genders": [
      1
    ],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 0.0,
    "spend": 3732.1,
    "impressions": 44698,
    "clicks": 4721,
    "reach": 15183,
    "frequency": 2.94,
    "results": 56,
    "costPerResult": 66.64,
    "spend7d": 3400.14,
    "results7d": 55,
    "costPerResult7d": 61.82,
    "frequency7d": 3.16,
    "startedAt": "2026-08-24"
  },
  {
    "id": "52552654519610",
    "campaignId": "52552654518610",
    "cityId": "nashik",
    "name": "Detailed-Audience",
    "status": "PAUSED",
    "optimizationGoal": "CONVERSATIONS",
    "resultType": "MESSAGING",
    "attributionSetting": "1d_view_7d_click",
    "geoCities": [
      "Nashik"
    ],
    "geoRegions": [],
    "customAudiences": [],
    "excludedAudiences": [],
    "interests": [
      "Used car (vehicle)"
    ],
    "ageMin": 25,
    "ageMax": 65,
    "genders": [
      1
    ],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 0.0,
    "spend": 1647.16,
    "impressions": 41880,
    "clicks": 320,
    "reach": 32455,
    "frequency": 1.29,
    "results": 48,
    "costPerResult": 34.32,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-08-05"
  },
  {
    "id": "52561278619610",
    "campaignId": "52561244309610",
    "cityId": "mohali",
    "name": "Consolidated-Mohali",
    "status": "ACTIVE",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_click",
    "geoCities": [
      "Mohali"
    ],
    "geoRegions": [],
    "customAudiences": [],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 24,
    "ageMax": 65,
    "genders": [
      1
    ],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 0.0,
    "spend": 239.41,
    "impressions": 2972,
    "clicks": 117,
    "reach": 2252,
    "frequency": 1.32,
    "results": 0,
    "costPerResult": 0.0,
    "spend7d": 239.41,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 1.32,
    "startedAt": "2026-08-31"
  },
  {
    "id": "52542534781810",
    "campaignId": "52542505854210",
    "cityId": "nashik",
    "name": "Detailed-Audience",
    "status": "ACTIVE",
    "optimizationGoal": "CONVERSATIONS",
    "resultType": "MESSAGING",
    "attributionSetting": "1d_view_7d_click",
    "geoCities": [
      "Nashik"
    ],
    "geoRegions": [],
    "customAudiences": [],
    "excludedAudiences": [],
    "interests": [
      "Used car (vehicle)"
    ],
    "ageMin": 18,
    "ageMax": 65,
    "genders": [],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 0.0,
    "spend": 0.0,
    "impressions": 0,
    "clicks": 0,
    "reach": 0,
    "frequency": 0.0,
    "results": 0,
    "costPerResult": 0.0,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-07-07"
  },
  {
    "id": "52542505854410",
    "campaignId": "52542505854210",
    "cityId": "nashik",
    "name": "Remarketing",
    "status": "PAUSED",
    "optimizationGoal": "CONVERSATIONS",
    "resultType": "MESSAGING",
    "attributionSetting": "1d_view_7d_click",
    "geoCities": [
      "Nashik"
    ],
    "geoRegions": [],
    "customAudiences": [
      "CD-FB-Buy Used Car-PV-nashik-90Days-New"
    ],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 18,
    "ageMax": 65,
    "genders": [],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 0.0,
    "spend": 0.0,
    "impressions": 0,
    "clicks": 0,
    "reach": 0,
    "frequency": 0.0,
    "results": 0,
    "costPerResult": 0.0,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-07-07"
  },
  {
    "id": "52541847401410",
    "campaignId": "52541847400410",
    "cityId": "nashik",
    "name": "Nashik-Catalogue - Detailed-Targeting",
    "status": "PAUSED",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_view_7d_click_1d_ev",
    "geoCities": [
      "Nashik"
    ],
    "geoRegions": [],
    "customAudiences": [],
    "excludedAudiences": [],
    "interests": [
      "Used car (vehicle)"
    ],
    "ageMin": 18,
    "ageMax": 65,
    "genders": [],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 1000.0,
    "spend": 0.0,
    "impressions": 0,
    "clicks": 0,
    "reach": 0,
    "frequency": 0.0,
    "results": 0,
    "costPerResult": 0.0,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-07-06"
  },
  {
    "id": "52541847401210",
    "campaignId": "52541847400410",
    "cityId": "nashik",
    "name": "Nashik-Remarkting",
    "status": "PAUSED",
    "optimizationGoal": "OFFSITE_CONVERSIONS",
    "resultType": "PIXEL_LEAD",
    "attributionSetting": "1d_view_7d_click_1d_ev",
    "geoCities": [
      "Nashik"
    ],
    "geoRegions": [],
    "customAudiences": [
      "CD-FB-Buy Used Car-PV-nashik-90Days-New"
    ],
    "excludedAudiences": [],
    "interests": [],
    "ageMin": 18,
    "ageMax": 65,
    "genders": [],
    "advantageAudience": true,
    "targetingOptimization": "expansion_all",
    "dailyBudget": 1015.39,
    "spend": 0.0,
    "impressions": 0,
    "clicks": 0,
    "reach": 0,
    "frequency": 0.0,
    "results": 0,
    "costPerResult": 0.0,
    "spend7d": 0.0,
    "results7d": 0,
    "costPerResult7d": 0.0,
    "frequency7d": 0.0,
    "startedAt": "2026-07-06"
  }
];
