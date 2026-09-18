/**
 * The thinnest possible Graph API layer.
 *
 * Two rules here, both learned the hard way from the way Meta reports errors:
 *
 *   1. A Graph error arrives as HTTP 400 with a JSON body that says what is
 *      actually wrong. Throwing "Request failed with status 400" destroys the
 *      only useful information in the response, so `GraphError` carries the
 *      message, type, code, subcode and `error_user_msg` through untouched.
 *
 *   2. Every write is logged before it is sent, in the exact shape it is sent.
 *      A campaign that appears in Ads Manager and nowhere in our records is a
 *      campaign nobody can explain later.
 */

/**
 * v23.0, not v21.0, and the version is a deliberate choice rather than a
 * default.
 *
 * Meta announced on 2025-08-11 that `instagram_actor_id` is replaced by
 * `instagram_user_id` beginning with Marketing API v22.0. On v21 the creative
 * field is still `instagram_actor_id`, and it wants a LEGACY Instagram actor
 * id — not the Instagram Business Account id (17841401516796675,
 * @cardekhoindia) that `act_X/instagram_accounts` returns. Sending the business
 * account id to the old field is exactly the "must be a valid Instagram account
 * id" rejection this account kept producing.
 *
 * So rather than hunt for a legacy id that may not exist any more, the app
 * moves to the version whose field takes the id we have verified. v23.0 is
 * chosen over v24.0 only because it has been out longer.
 *
 * Overridable, so a version-specific regression can be backed out from .env
 * without a code change.
 */
const GRAPH_VERSION = process.env.META_GRAPH_VERSION?.trim() || "v23.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

import { createHmac } from "crypto";
import { currentAccountId, currentToken } from "./credentials";
import { noteRateLimited } from "./throttle";

export class GraphError extends Error {
  readonly type: string;
  readonly code: number;
  readonly subcode: number | null;
  /** Meta's own user-facing wording, which is usually the actionable part. */
  readonly userMessage: string | null;
  readonly userTitle: string | null;
  readonly path: string;
  readonly payload: Record<string, unknown>;

  constructor(
    path: string,
    payload: Record<string, unknown>,
    body: {
      message?: string;
      type?: string;
      code?: number;
      error_subcode?: number;
      error_user_msg?: string;
      error_user_title?: string;
    }
  ) {
    super(body.error_user_msg || body.message || "Graph API call failed");
    this.name = "GraphError";
    this.type = body.type ?? "unknown";
    this.code = body.code ?? 0;
    this.subcode = body.error_subcode ?? null;
    this.userMessage = body.error_user_msg ?? null;
    this.userTitle = body.error_user_title ?? null;
    this.path = path;
    this.payload = payload;
  }

  /** What to show an operator: Meta's wording, plus which call failed. */
  describe(): string {
    const where = `${this.path} (code ${this.code}${this.subcode ? `/${this.subcode}` : ""})`;
    const base = this.userTitle ? `${this.userTitle}: ${this.message} — ${where}` : `${this.message} — ${where}`;

    // Rate limiting is per AD ACCOUNT, not per user or per screen, so hitting
    // it from a reporting page also blocks publishing. Say that, because the
    // instinct on seeing it is to retry immediately, which extends the block.
    if (this.code === 17 || this.code === 613 || this.subcode === 2446079) {
      return (
        `${base}. This limit is per ad account, so it also blocks publishing until it clears — ` +
        `wait a few minutes rather than retrying, and avoid reloading reporting screens in the meantime.`
      );
    }

    // "Ads creative post was created by an app that is in development mode."
    //
    // Nothing in the request is wrong. Every Meta app starts in Development
    // mode, where it can read the account and create campaigns and ad sets but
    // cannot create an ad creative that references a Page post — so a publish
    // run gets all the way to the last step and then fails, which reads like a
    // creative problem and is not one.
    //
    // Worth being precise about the limit: this is an app setting, not a
    // permission on the token, so regenerating the token or adding scopes will
    // not shift it.
    if (this.subcode === 1885183 || /development mode/i.test(this.message)) {
      return (
        `${base}. This is the app's own mode, not a problem with the campaign or the token. ` +
        `An app in Development mode cannot create ad creatives that reference a Page post, which is why ` +
        `campaigns and ad sets succeed and the creative step fails. Switch the app to Live at ` +
        `developers.facebook.com → the app → the Development/Live toggle at the top. Going Live requires the app's ` +
        `basic settings to be complete and any outstanding Platform Terms issues to be cleared first.`
      );
    }

    // Meta says what is missing but not where to put it. This one is worth
    // spelling out, because it stops every server call, not just the one that
    // happened to run first.
    if (/appsecret_proof/i.test(this.message) && !process.env.META_APP_SECRET?.trim()) {
      return (
        `${base}. The app requires a signed proof on server calls and META_APP_SECRET is not set in .env — ` +
        `copy the app secret from the app dashboard (Settings → Basic → App secret → Show) into META_APP_SECRET and restart.`
      );
    }
    return base;
  }
}

export interface GraphCall {
  /** Ordinal within a publish run, so a failure names the step that failed. */
  step: number;
  label: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  payload: Record<string, unknown>;
  /**
   * A step the launch can survive without. The page-visitor audience is the
   * case: it is preparation for day 30, not something the campaign needs in
   * order to run, so failing to create it should not take the campaign down
   * with it.
   */
  optional?: boolean;
}

export interface GraphCallResult extends GraphCall {
  status: "OK" | "FAILED" | "SKIPPED";
  /** The id Meta assigned, when the call created something. */
  id?: string;
  error?: string;
  /** True when this ran against the API; false for a dry run. */
  sent: boolean;
}

/**
 * The token for this call.
 *
 * Was a direct read of META_ACCESS_TOKEN. It now asks the credential layer,
 * which returns the token belonging to the ad account this request is about and
 * falls back to the system user token when that account has none of its own —
 * which today is every account. See lib/meta/credentials.ts for why the
 * indirection exists before it is needed.
 */
function token(): string {
  return currentToken();
}

/**
 * `appsecret_proof` — the signature Meta wants on server-side calls.
 *
 * AdAutomationMgr has "Require app secret proof for server API calls" switched
 * on, so every request from a server must carry an HMAC-SHA256 of the access
 * token keyed with the app secret. Without it Meta rejects the call before it
 * looks at anything else, which is why this surfaced on the catalogue button
 * and would equally have stopped campaign creation.
 *
 * The alternative was to turn the setting off in the app dashboard. That trades
 * a real protection — a stolen token is useless without the secret — for two
 * lines of code, so it is not the trade to make.
 *
 * The secret is only ever used here, to compute the digest. It is never sent.
 */
function appSecretProof(accessToken: string): string | null {
  const secret = process.env.META_APP_SECRET?.trim();
  if (!secret) return null;
  return createHmac("sha256", secret).update(accessToken).digest("hex");
}

/** Adds access_token and, when the app demands it, appsecret_proof. */
function withAuth(params: URLSearchParams): URLSearchParams {
  const t = token();
  params.set("access_token", t);
  const proof = appSecretProof(t);
  if (proof) params.set("appsecret_proof", proof);
  return params;
}

/**
 * Graph expects nested objects as JSON strings in a form body, not as JSON.
 * Getting this wrong produces "param targeting must be an object", which is
 * an unhelpful way of saying "you sent an object where a string was wanted".
 */
export function encodeParams(payload: Record<string, unknown>): URLSearchParams {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  return form;
}

/**
 * True when Meta is telling us to back off from this ad account.
 *
 * Lives here rather than in throttle.ts because GraphError is defined here and
 * the reverse import would be a cycle.
 */
export function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof GraphError)) return false;
  return err.code === 17 || err.code === 613 || err.subcode === 2446079;
}

/**
 * Raise a Graph failure, recording a rate limit against the current account.
 *
 * Every helper below goes through this, so the cooling-off window opens no
 * matter which read tripped it - including one added tomorrow by someone who
 * has never heard of throttle.ts.
 */
/**
 * How long Meta says this ad account needs, in minutes.
 *
 * Meta returns its own rate-limit accounting on every response, in
 * `x-business-use-case-usage` (and `x-ad-account-usage` on older paths). The
 * useful field is `estimated_time_to_regain_access`, in MINUTES.
 *
 * Reading it matters more than it sounds. The cooling-off window was a flat
 * five minutes, which was a guess - and when Meta wants an hour, a five-minute
 * window means the app waits, retries into a still-closed door, gets refused,
 * and starts another five minutes. From the outside that is indistinguishable
 * from being permanently broken, which is exactly what BikeDekho looked like
 * all afternoon. Meta was saying how long the whole time.
 *
 * Returns 0 when the header is absent or unparseable, which is not an error -
 * the caller falls back to its own minimum.
 */
function estimatedMinutesToRegainAccess(res: Response): number {
  for (const header of ["x-business-use-case-usage", "x-ad-account-usage"]) {
    const raw = res.headers.get(header);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      // Keyed by business or account id, each holding an array of entries.
      const entries: unknown[] =
        Array.isArray(parsed) ? parsed : Object.values(parsed as Record<string, unknown>).flat();
      let worst = 0;
      for (const entry of entries) {
        const minutes = Number((entry as { estimated_time_to_regain_access?: unknown })?.estimated_time_to_regain_access);
        if (Number.isFinite(minutes) && minutes > worst) worst = minutes;
      }
      if (worst > 0) return worst;
    } catch {
      /* a header we do not understand is not a reason to fail the call */
    }
  }
  return 0;
}

function fail(
  path: string,
  payload: Record<string, unknown>,
  body: Record<string, unknown>,
  res?: Response
): never {
  const err = new GraphError(path, payload, (body.error ?? { message: "Graph API call failed" }) as never);
  if (isRateLimitError(err)) {
    const minutes = res ? estimatedMinutesToRegainAccess(res) : 0;
    noteRateLimited(currentAccountId(), err.message, minutes > 0 ? minutes * 60_000 : undefined);
  }
  throw err;
}

export async function graphPost<T = { id: string }>(
  path: string,
  payload: Record<string, unknown>
): Promise<T> {
  const form = withAuth(encodeParams(payload));

  const res = await fetch(`${GRAPH_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: ConstructorParameters<typeof GraphError>[2];
  };
  if (!res.ok || body.error) {
    fail(path, payload, { error: body.error ?? { message: `HTTP ${res.status}` } }, res);
  }
  return body as T;
}

export async function graphGet<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string> = {}
): Promise<T> {
  const qs = withAuth(new URLSearchParams({ ...params }));
  const res = await fetch(`${GRAPH_BASE}/${path}?${qs.toString()}`);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: ConstructorParameters<typeof GraphError>[2];
  };
  if (!res.ok || body.error) {
    fail(path, params, { error: body.error ?? { message: `HTTP ${res.status}` } }, res);
  }
  return body as T;
}

export async function graphDelete(path: string): Promise<void> {
  const qs = withAuth(new URLSearchParams());
  const res = await fetch(`${GRAPH_BASE}/${path}?${qs.toString()}`, { method: "DELETE" });
  const body = (await res.json().catch(() => ({}))) as { error?: ConstructorParameters<typeof GraphError>[2] };
  if (!res.ok || body.error) {
    fail(path, {}, { error: body.error ?? { message: `HTTP ${res.status}` } }, res);
  }
}

/** `act_` prefix, added once and only once. */
export function actPath(adAccountId: string, edge: string): string {
  const id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  return `${id}/${edge}`;
}

// ---------------------------------------------------------------------------
// Geo resolution
// ---------------------------------------------------------------------------

export interface GeoCity {
  key: string;
  name: string;
  region: string;
  country: string;
}

/**
 * Meta targets cities by its own numeric key, never by name — the live ad sets
 * carry `{"key":1015741,"name":"Ahmedabad"}`. Our model stores the name the
 * operator typed, so a launch has to resolve it here or target nothing.
 *
 * Ambiguity is returned rather than resolved: India has more than one
 * Aurangabad, and silently picking the larger one puts a campaign in the wrong
 * state.
 */
interface RawGeo {
  key: string;
  name: string;
  region?: string;
  country_code?: string;
  country_name?: string;
  type?: string;
}

/**
 * Asked Meta for ten results worldwide and then kept the Indian ones.
 *
 * That is the wrong order. The limit is spent before the filter runs, so a name
 * that also exists in a country Meta ranks higher can come back with nothing
 * left for India — a city of two million reported as "no Indian city matching".
 * `country_code` moves the restriction to Meta's side, where it belongs, and the
 * local filter stays as a belt-and-braces check.
 */
async function geoSearch(name: string, country: string, types: string[]): Promise<RawGeo[]> {
  const params: Record<string, string> = {
    type: "adgeolocation",
    location_types: JSON.stringify(types),
    q: name,
    limit: "25",
  };
  try {
    const body = await graphGet<{ data: RawGeo[] }>("search", { ...params, country_code: country });
    return body.data ?? [];
  } catch (err) {
    // If this version of the endpoint will not take country_code, fall back to
    // the unrestricted search rather than reporting the city as missing. A
    // slower answer beats a wrong one.
    if (err instanceof GraphError && err.code === 100) {
      const body = await graphGet<{ data: RawGeo[] }>("search", params);
      return body.data ?? [];
    }
    throw err;
  }
}

/**
 * Meta targets cities by its own numeric key, never by name — the live ad sets
 * carry `{"key":1015741,"name":"Ahmedabad"}`. Our model stores the name the
 * operator typed, so a launch has to resolve it here or target nothing.
 *
 * Ambiguity is returned rather than resolved: India has more than one
 * Aurangabad, and silently picking the larger one puts a campaign in the wrong
 * state.
 */
export async function searchCity(name: string, country = "IN"): Promise<GeoCity[]> {
  const data = await geoSearch(name, country, ["city"]);
  return data
    .filter((c) => !country || c.country_code === country)
    .map((c) => ({
      key: String(c.key),
      name: c.name,
      region: c.region ?? "",
      country: c.country_code ?? country,
    }));
}

/**
 * Everything Meta knows by this name, whatever kind of place it is.
 *
 * Used only to explain a miss. A name that returns no CITY may still exist as a
 * subcity, a neighbourhood or a region, and "Meta has no Indian city matching
 * X" is a far less useful thing to read than "Meta lists X as a subcity of
 * Pune, which cannot be targeted as a city". Targeting is untouched by this —
 * these keys go in different buckets of the targeting spec and are deliberately
 * not substituted for a city.
 */
export async function searchPlaceOfAnyType(
  name: string,
  country = "IN"
): Promise<(GeoCity & { type: string })[]> {
  const data = await geoSearch(name, country, [
    "subcity",
    "neighborhood",
    "region",
    "metro_area",
    "medium_geo_area",
  ]);
  return data
    .filter((c) => !country || c.country_code === country)
    .map((c) => ({
      key: String(c.key),
      name: c.name,
      region: c.region ?? "",
      country: c.country_code ?? country,
      type: c.type ?? "place",
    }));
}
