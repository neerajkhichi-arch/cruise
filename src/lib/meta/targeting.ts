/**
 * Filling in the targeting fields Meta now requires on a new ad set.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO PREVENT
 *
 * A bulk city run created its campaign and then failed on the ad set with:
 *
 *   To create your ad set, you need to enable or disable the Advantage audience
 *   feature. This can be done by setting the advantage_audience flag to either 1
 *   or 0 within the targeting_automation field in the targeting spec.
 *
 * Meta made this flag mandatory for new ad sets. Older ad sets do not carry it,
 * so copying a source's targeting verbatim produces a spec that is complete as
 * far as the source is concerned and incomplete as far as creation is
 * concerned — the campaign is created, the ad set is refused, and the run rolls
 * back.
 *
 * WHY THE DEFAULT IS OFF
 *
 * Advantage audience lets Meta deliver outside the targeting the ad set
 * specifies. Defaulting it ON would mean a replica quietly reaching people the
 * source never targeted, which is the same failure as the Gurgaon geo bug in a
 * different coat: the campaign looks like a copy and is not one. So a source
 * that has the flag has its value copied, and a source that does not gets 0,
 * with the choice stated rather than assumed.
 * ---------------------------------------------------------------------------
 */

export interface TargetingCompletion {
  targeting: Record<string, unknown>;
  /** Non-null when a value had to be supplied rather than copied. */
  note: string | null;
}

export function completeTargeting(targeting: Record<string, unknown>): TargetingCompletion {
  const automation = (targeting.targeting_automation ?? {}) as Record<string, unknown>;
  const existing = automation.advantage_audience;

  // 0 and 1 are both meaningful; only an absent or malformed value is filled in.
  if (existing === 0 || existing === 1 || existing === "0" || existing === "1") {
    return { targeting, note: null };
  }

  return {
    targeting: {
      ...targeting,
      targeting_automation: { ...automation, advantage_audience: 0 },
    },
    note:
      "The source ad set predates Meta's Advantage audience flag, which is now required on any new ad set. " +
      "It was set to off, so this ad set reaches exactly the targeting it specifies rather than letting Meta " +
      "expand beyond it. Turn it on in Ads Manager if you want the expansion.",
  };
}
