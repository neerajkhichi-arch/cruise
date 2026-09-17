/**
 * Translating a source campaign's objective into one Meta will still accept.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO PREVENT
 *
 * A bulk city run died with:
 *
 *   (#100) Objective WEBSITE_CONVERSIONS is invalid. Use one of: OUTCOME_LEADS,
 *   OUTCOME_SALES, OUTCOME_ENGAGEMENT, OUTCOME_AWARENESS, OUTCOME_TRAFFIC,
 *   OUTCOME_APP_PROMOTION.
 *
 * Nothing was wrong with the source campaign. Meta moved to the ODAX objectives
 * years ago and still REPORTS the legacy name on campaigns created before the
 * change — it just will not let you CREATE one with it. Every copy path in this
 * app read the source's objective and passed it through verbatim, so any
 * campaign old enough to predate ODAX could be read, measured and reported on,
 * and could not be replicated.
 *
 * The mapping is not always one to one. WEBSITE_CONVERSIONS became two
 * objectives — OUTCOME_LEADS and OUTCOME_SALES — and which one is right depends
 * on what the ad set actually optimises for, not on the objective's name. So
 * that case reads the promoted object rather than guessing from the campaign.
 * ---------------------------------------------------------------------------
 */

/** The six objectives Meta will accept on a new campaign. */
const ODAX = new Set([
  "OUTCOME_LEADS",
  "OUTCOME_SALES",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_AWARENESS",
  "OUTCOME_TRAFFIC",
  "OUTCOME_APP_PROMOTION",
]);

/** Legacy objectives with exactly one sensible successor. */
const DIRECT: Record<string, string> = {
  LEAD_GENERATION: "OUTCOME_LEADS",
  LINK_CLICKS: "OUTCOME_TRAFFIC",
  TRAFFIC: "OUTCOME_TRAFFIC",
  POST_ENGAGEMENT: "OUTCOME_ENGAGEMENT",
  PAGE_LIKES: "OUTCOME_ENGAGEMENT",
  EVENT_RESPONSES: "OUTCOME_ENGAGEMENT",
  MESSAGES: "OUTCOME_ENGAGEMENT",
  VIDEO_VIEWS: "OUTCOME_ENGAGEMENT",
  BRAND_AWARENESS: "OUTCOME_AWARENESS",
  REACH: "OUTCOME_AWARENESS",
  STORE_VISITS: "OUTCOME_AWARENESS",
  LOCAL_AWARENESS: "OUTCOME_AWARENESS",
  APP_INSTALLS: "OUTCOME_APP_PROMOTION",
  MOBILE_APP_INSTALLS: "OUTCOME_APP_PROMOTION",
  MOBILE_APP_ENGAGEMENT: "OUTCOME_APP_PROMOTION",
  PRODUCT_CATALOG_SALES: "OUTCOME_SALES",
  CATALOG_SALES: "OUTCOME_SALES",
};

/** Standard pixel events that mean a lead rather than a sale. */
const LEAD_EVENTS = new Set([
  "LEAD",
  "COMPLETE_REGISTRATION",
  "SUBMIT_APPLICATION",
  "CONTACT",
  "SCHEDULE",
  "START_TRIAL",
  "SUBSCRIBE",
  "FIND_LOCATION",
]);

/** Standard pixel events that mean a sale. */
const SALE_EVENTS = new Set([
  "PURCHASE",
  "ADD_TO_CART",
  "INITIATED_CHECKOUT",
  "ADD_PAYMENT_INFO",
  "ADD_TO_WISHLIST",
]);

export interface ObjectiveTranslation {
  /** What to send to Meta. */
  objective: string;
  /** True when this differs from the source's objective. */
  changed: boolean;
  /**
   * Worth putting in front of the operator when `changed` — silently swapping
   * the objective of a campaign that spends money is not something to do
   * without saying so.
   */
  note: string | null;
}

/**
 * @param sourceObjective what the source campaign reports
 * @param promotedObject the SOURCE AD SET's promoted_object, which is what
 *        actually says whether this optimises for a lead or a sale
 */
export function translateObjective(
  sourceObjective: string,
  promotedObject?: Record<string, unknown> | null
): ObjectiveTranslation {
  const objective = (sourceObjective ?? "").trim().toUpperCase();

  if (ODAX.has(objective)) return { objective, changed: false, note: null };

  const direct = DIRECT[objective];
  if (direct) {
    return {
      objective: direct,
      changed: true,
      note:
        `The source campaign uses ${objective}, which Meta no longer accepts on new campaigns. ` +
        `This one was created as ${direct}, its current equivalent.`,
    };
  }

  // CONVERSIONS and WEBSITE_CONVERSIONS split into two modern objectives, so
  // read what the ad set optimises for instead of picking one by name.
  if (objective === "CONVERSIONS" || objective === "WEBSITE_CONVERSIONS" || objective === "OFFSITE_CONVERSIONS") {
    const eventType = String(promotedObject?.custom_event_type ?? "").toUpperCase();
    const eventStr = String(
      promotedObject?.custom_event_str ?? promotedObject?.custom_conversion_id ?? ""
    ).toUpperCase();

    if (LEAD_EVENTS.has(eventType)) {
      return {
        objective: "OUTCOME_LEADS",
        changed: true,
        note:
          `The source campaign uses ${objective}, which Meta retired. It became OUTCOME_LEADS here because the ` +
          `source ad set optimises for ${eventType}, a lead event.`,
      };
    }
    if (SALE_EVENTS.has(eventType)) {
      return {
        objective: "OUTCOME_SALES",
        changed: true,
        note:
          `The source campaign uses ${objective}, which Meta retired. It became OUTCOME_SALES here because the ` +
          `source ad set optimises for ${eventType}, a purchase event.`,
      };
    }

    // A custom conversion — which is what this account uses. Nothing in the
    // promoted object names a standard event, so the name is the only signal
    // there is. Said out loud rather than decided quietly.
    const looksLikeLead = /LEAD|ENQUIR|FORM|SUBMIT|CONTACT|REGISTER/.test(eventStr) || eventType === "OTHER";
    const chosen = looksLikeLead ? "OUTCOME_LEADS" : "OUTCOME_SALES";
    return {
      objective: chosen,
      changed: true,
      note:
        `The source campaign uses ${objective}, which Meta retired and will not accept on a new campaign. ` +
        `Its ad set optimises for a custom conversion rather than a standard event, so Cruise created this as ` +
        `${chosen}. Check that is right before it delivers — the objective cannot be changed after the campaign ` +
        `is created, only replaced.`,
    };
  }

  // Unknown and unmapped. Refusing beats sending something Meta will reject, or
  // worse, something it accepts that means the wrong thing.
  return {
    objective: "",
    changed: true,
    note:
      `The source campaign's objective is "${objective || "(none reported)"}", which is neither one of Meta's ` +
      `current objectives nor a legacy one this app knows how to translate. Create the first campaign for this ` +
      `objective by hand in Ads Manager, then replicate from that one.`,
  };
}
