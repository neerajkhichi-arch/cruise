/**
 * The ad account's existing custom audiences.
 *
 * Nothing in this app read these before. It created one — the city page-visitor
 * audience — and deliberately never attached it, because an audience created
 * five minutes ago is empty and an ad set pointed at it does not deliver. That
 * caution was right, and the fix is not to drop it: it is to read the SIZE of
 * an audience before offering it, so a usable one can be used and an empty one
 * is refused for a stated reason.
 *
 * Two numbers matter and they are not the same:
 *
 *   `delivery_status` is Meta's own verdict on whether this audience can be
 *   used right now. It is authoritative and it is the one to trust — Meta
 *   knows about matching rates and privacy floors that a raw count does not
 *   show.
 *
 *   `approximate_count_*` is a range, not a number. Meta stopped reporting
 *   exact sizes, so this is a lower and upper bound and the honest thing is to
 *   show it as a range rather than pick one end and print it as fact.
 *
 * The size floor applies only to audiences being TARGETED. Excluding a small
 * audience is harmless — removing 50 people from a broad buy costs nothing and
 * breaks nothing — so an audience too small to target is still perfectly valid
 * to exclude, and refusing it for exclusion would be a rule with no reason
 * behind it.
 */

import { actPath, graphGet } from "./graph";
import { TTL, cached } from "./cache";

/**
 * Below this, a targeted audience will not deliver.
 *
 * Meta's `delivery_status` is the real gate; this is a second check for the
 * case where Meta reports a status of "ready" on an audience that is still
 * filling. Deliberately not lower: an ad set that technically delivers to 200
 * people burns its learning phase and teaches you nothing.
 */
export const MIN_TARGETABLE_AUDIENCE = 1000;

export interface CustomAudienceRow {
  id: string;
  name: string;
  /** CUSTOM, WEBSITE, LOOKALIKE, ENGAGEMENT, … as Meta reports it. */
  subtype: string | null;
  description: string | null;
  retentionDays: number | null;
  /** Meta reports a range, never an exact figure. Either end may be null. */
  sizeLower: number | null;
  sizeUpper: number | null;
  /** False when Meta withheld the size (the 1000–1000 placeholder). */
  sizeDisclosed: boolean;
  /** Meta's own delivery verdict. */
  deliveryCode: number | null;
  deliveryDescription: string | null;
  /** Last time Meta refreshed it, ISO. */
  updatedAt: string | null;
  /** Safe to TARGET — Meta says ready and it is big enough to deliver. */
  targetable: boolean;
  /** Why not, when it is not. Shown next to the option rather than hidden. */
  reason: string | null;
}

interface RawAudience {
  id: string;
  name?: string;
  description?: string;
  subtype?: string;
  retention_days?: number;
  approximate_count_lower_bound?: number;
  approximate_count_upper_bound?: number;
  /** Object on the Graph API; tolerated as a plain string too. */
  delivery_status?: { code?: number; description?: string } | string;
  operation_status?: { code?: number; description?: string } | string;
  time_updated?: number;
}

/**
 * Meta reports EXACTLY 1000–1000 when it will not disclose an audience's size.
 *
 * It is a privacy placeholder, not a measurement, and reading it as "about a
 * thousand people" is wrong in both directions: this account's 1% India
 * lookalike of a 100,000-person seed reports 1000–1000, and its true size is
 * well over a million. A size floor that treated it as a real count would
 * reject perfectly good audiences for a reason that is simply false.
 *
 * So a withheld size is treated as "unknown", and the decision falls to Meta's
 * own delivery and operation status, which is the honest place for it.
 */
const PRIVACY_PLACEHOLDER = 1000;

function sizeDisclosed(a: RawAudience): boolean {
  return !(
    a.approximate_count_lower_bound === PRIVACY_PLACEHOLDER &&
    a.approximate_count_upper_bound === PRIVACY_PLACEHOLDER
  );
}

/** Meta's status fields, read whether they arrive as an object or a string. */
function readStatus(v: RawAudience["delivery_status"]): { ok: boolean | null; text: string | null } {
  if (v === undefined || v === null) return { ok: null, text: null };
  if (typeof v === "string") {
    const s = v.trim().toUpperCase();
    if (!s) return { ok: null, text: null };
    return { ok: s === "ACTIVE" || s === "NORMAL" || s === "READY", text: v };
  }
  if (typeof v.code === "number") return { ok: v.code === 200, text: v.description ?? `code ${v.code}` };
  return { ok: null, text: v.description ?? null };
}

const FIELDS = [
  "id",
  "name",
  "description",
  "subtype",
  "retention_days",
  "approximate_count_lower_bound",
  "approximate_count_upper_bound",
  "delivery_status",
  "operation_status",
  "time_updated",
].join(",");

function assess(a: RawAudience): { targetable: boolean; reason: string | null } {
  const delivery = readStatus(a.delivery_status);
  const operation = readStatus(a.operation_status);

  // Meta's own verdicts come first, because they know things a count does not
  // show — a lookalike that has never been built, an audience deactivated for
  // disuse, a source list that failed to match.
  if (delivery.ok === false) {
    return {
      targetable: false,
      reason: `Meta reports delivery as ${delivery.text ?? "not ready"}. An audience in this state is not eligible for targeting until it is rebuilt or used again.`,
    };
  }
  if (operation.ok === false) {
    return {
      targetable: false,
      reason: `Meta reports this audience as ${operation.text ?? "not usable"}.`,
    };
  }

  // Only judge size when Meta actually disclosed one. See PRIVACY_PLACEHOLDER.
  if (sizeDisclosed(a)) {
    const upper = a.approximate_count_upper_bound ?? null;
    if (upper !== null && upper < MIN_TARGETABLE_AUDIENCE) {
      return {
        targetable: false,
        reason: `About ${upper.toLocaleString("en-IN")} people — too few to deliver. An ad set targeting this would be approved and then serve almost nothing.`,
      };
    }
  }

  return { targetable: true, reason: null };
}

export async function listCustomAudiences(adAccountId: string): Promise<CustomAudienceRow[]> {
  const rows = await cached(`audiences:${adAccountId}`, TTL.catalogue, async () => {
    const out: RawAudience[] = [];
    let after: string | undefined;
    // Capped. An account with hundreds of audiences would otherwise page
    // through all of them on every read, and Meta's rate limit is per ad
    // account — a listing that blocks a publish is worse than a short list.
    let pages = 0;
    do {
      pages += 1;
      const page = await graphGet<{
        data: RawAudience[];
        paging?: { cursors?: { after?: string }; next?: string };
      }>(actPath(adAccountId, "customaudiences"), {
        fields: FIELDS,
        limit: "200",
        ...(after ? { after } : {}),
      });
      out.push(...(page.data ?? []));
      after = page.paging?.next ? page.paging?.cursors?.after : undefined;
    } while (after && pages < 5);
    return out;
  });

  return rows
    .map((a) => {
      const { targetable, reason } = assess(a);
      return {
        id: a.id,
        name: a.name ?? "(unnamed)",
        subtype: a.subtype ?? null,
        description: a.description ?? null,
        retentionDays: a.retention_days ?? null,
        sizeLower: a.approximate_count_lower_bound ?? null,
        sizeUpper: a.approximate_count_upper_bound ?? null,
        sizeDisclosed: sizeDisclosed(a),
        deliveryCode: typeof a.delivery_status === "object" ? a.delivery_status?.code ?? null : null,
        deliveryDescription: readStatus(a.delivery_status).text,
        updatedAt: a.time_updated ? new Date(a.time_updated * 1000).toISOString() : null,
        targetable,
        reason,
      };
    })
    // Usable ones first, then alphabetically — the list is long and the ones
    // you can actually act on should not be scattered through it.
    .sort((x, y) => Number(y.targetable) - Number(x.targetable) || x.name.localeCompare(y.name));
}

/** "12,000–13,000 people", or an honest single-ended range. */
export function formatAudienceSize(a: Pick<CustomAudienceRow, "sizeLower" | "sizeUpper" | "sizeDisclosed">): string {
  const fmt = (n: number) => n.toLocaleString("en-IN");
  // Never print the privacy placeholder as though it were a measurement.
  if (!a.sizeDisclosed) return "size not disclosed by Meta";
  if (a.sizeLower !== null && a.sizeUpper !== null) {
    return a.sizeLower === a.sizeUpper ? `${fmt(a.sizeLower)} people` : `${fmt(a.sizeLower)}–${fmt(a.sizeUpper)} people`;
  }
  if (a.sizeUpper !== null) return `under ${fmt(a.sizeUpper)} people`;
  if (a.sizeLower !== null) return `over ${fmt(a.sizeLower)} people`;
  return "size not reported";
}
