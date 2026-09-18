/**
 * What counts as a result for ONE ad set, derived from what it optimises for.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * "Which event is a lead" was asked once per ad ACCOUNT. That question has no
 * answer on a real account. Media Sales-Non-Auto reports, in the same month:
 *
 *   offsite_conversion.fb_pixel_lead                 22,447
 *   onsite_web_lead                                  22,458
 *   offsite_conversion.fb_pixel_custom.SavingsLead   11,057
 *   offsite_conversion.fb_pixel_custom.TermLead       8,709
 *   leadgen.other                                     (instant forms)
 *
 * Those are not competing answers to one question. They are the results of
 * different campaigns, each optimising for a different thing. Asking a person
 * to choose one of them means choosing which campaigns report honestly and
 * which report zero.
 *
 * Meta does not have this problem, because Ads Manager counts each campaign by
 * what that campaign was set up to achieve. So does this now. The ad set
 * already carries the answer in `optimization_goal` and `promoted_object` —
 * the same two fields that decide what Meta actually delivers against — and
 * every one of those fields was already being fetched.
 *
 * The account-level setting survives as a FALLBACK, for the case where an ad
 * set does not say: an older campaign with no promoted object, or a goal this
 * mapping has not seen. It is no longer the primary answer, which means a new
 * account reports correctly before anybody configures anything.
 * ---------------------------------------------------------------------------
 */

/** The parts of an ad set that determine what its results are. */
export interface ResultSource {
  optimization_goal?: string;
  promoted_object?: {
    custom_event_type?: string;
    custom_event_str?: string;
  };
}

/** Leads submitted on an instant form, never through the website pixel. */
export const LEAD_FORM_ACTIONS = ["leadgen.other", "onsite_conversion.lead_grouped"];

/** Conversations started, for click-to-message campaigns. */
export const MESSAGING_ACTIONS = [
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.total_messaging_connection",
];

/**
 * A standard pixel event's action type.
 *
 * Meta names these `offsite_conversion.fb_pixel_<event>` in lower case, so
 * PURCHASE becomes offsite_conversion.fb_pixel_purchase. Derived rather than
 * listed, because a table of thirty standard events would be missing the
 * thirty-first the day somebody used it.
 */
function standardPixelAction(eventType: string): string {
  return `offsite_conversion.fb_pixel_${eventType.trim().toLowerCase()}`;
}

/** A custom pixel event's action type. */
export function customPixelAction(eventName: string): string {
  return `offsite_conversion.fb_pixel_custom.${eventName.trim()}`;
}

/**
 * The action types that count as this ad set's result, best first.
 *
 * A LIST rather than one value, because some results are reported under more
 * than one name — an instant-form lead appears as `leadgen.other` on current
 * accounts and as `onsite_conversion.lead_grouped` on older ones. The caller
 * takes the LARGEST match, never the sum: they are the same leads counted
 * twice, and adding them would double every lead-form campaign.
 *
 * `fallback` is the account's configured lead event, used only when the ad set
 * itself does not say what it is optimising for.
 */
export function resultActionsFor(source: ResultSource | undefined, fallback: string): string[] {
  const goal = source?.optimization_goal?.toUpperCase();
  const promoted = source?.promoted_object;

  // --- on-Facebook instant forms ------------------------------------------
  if (goal === "LEAD_GENERATION" || goal === "QUALITY_LEAD") return LEAD_FORM_ACTIONS;

  // --- click to message ----------------------------------------------------
  if (goal === "CONVERSATIONS" || goal === "QUALITY_CALL" || goal === "MESSAGING_PURCHASE_CONVERSION") {
    return MESSAGING_ACTIONS;
  }

  // --- a website conversion, which the promoted object names ---------------
  //
  // custom_event_type is the authority here. "OTHER" means a custom event and
  // custom_event_str carries its name; anything else is one of Meta's standard
  // events and follows the standard naming.
  const eventType = promoted?.custom_event_type?.toUpperCase();
  if (eventType === "OTHER") {
    const name = promoted?.custom_event_str?.trim();
    // A custom event with no name is the one case where the ad set is genuinely
    // unhelpful: Meta returns OTHER and omits which. The account's setting is
    // the best available guess and is usually right, because an account's
    // custom-event campaigns tend to share one event.
    return name ? [customPixelAction(name)] : [fallback];
  }
  if (eventType) return [standardPixelAction(eventType)];

  // --- nothing to go on ----------------------------------------------------
  return [fallback];
}

/**
 * The count for this ad set's result type, given the insight row's actions.
 *
 * Takes the largest of the candidates rather than the sum — see above.
 */
export function countResult(
  rows: { action_type: string; value: string }[],
  actions: string[]
): { value: number; matched: string | null } {
  let best = 0;
  let matched: string | null = null;
  for (const action of actions) {
    const hit = rows.find((r) => r.action_type === action);
    const value = Number(hit?.value ?? 0) || 0;
    if (value > best) {
      best = value;
      matched = action;
    }
  }
  // Nothing fired. Name the action anyway, so a zero can be checked against
  // Ads Manager rather than merely disbelieved.
  return { value: best, matched: matched ?? actions[0] ?? null };
}
