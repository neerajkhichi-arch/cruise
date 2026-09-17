/**
 * Whether the seeded platform tables may be shown.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE TABLES ARE
 *
 * `campaigns`, `ad_sets`, `performance_daily`, `leads`, `vehicles` and `cities`
 * were filled by scripts/seed.ts for the demo. They were last written on
 * 2026-09-01 and nothing updates them now. Several screens still read them.
 *
 * On one operator's laptop that was a known quirk. On a shared deployment it is
 * something else entirely: a colleague opening Reports would read plausible
 * rupee figures for campaigns they manage, with no way to tell they were
 * invented. Numbers nobody can trace are worse than no numbers, because a
 * decision gets made on them.
 *
 * So: the moment this install is pointed at a real ad account
 * (USE_MOCK_META=false), the seeded tables stop being served. The screens say
 * they have nothing rather than showing something false.
 *
 * These tables are NOT scoped to an ad account either — there is one set of
 * rows for the whole install — which is the second reason they cannot be shown
 * on a platform carrying several businesses' accounts.
 * ---------------------------------------------------------------------------
 */

export function seededDataAllowed(): boolean {
  return process.env.USE_MOCK_META !== "false";
}

/** What a screen should say when it has nothing real to show. */
export const SEEDED_DATA_WITHHELD =
  "This screen still reads the demo tables, which were seeded during development and last updated on " +
  "1 September 2026. They are not scoped to an ad account and nothing refreshes them, so they are withheld " +
  "on a live install rather than shown as though they were current. The Dashboard, Campaigns, Cities and " +
  "Lead targets screens read Meta directly and are unaffected.";
