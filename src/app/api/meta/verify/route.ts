import { NextResponse } from "next/server";
import { requireAccount } from "@/lib/api-auth";
import { graphGet, GraphError } from "@/lib/meta/graph";
import { ACCOUNT } from "../../../../../scripts/verified-account-facts";
import { DEFAULT_CATALOGUE_ID } from "../../../../../scripts/real-catalogue-data";

/**
 * Does this token actually do what publishing needs?
 *
 * A token can be present and still be wrong in four different ways: expired,
 * missing a scope, not assigned to the ad account, or not assigned to the
 * catalogue. Each of those fails at a different step of a publish, halfway
 * through, which is the worst time to discover it. So every one is checked
 * up front, separately, and reported by name.
 */

interface Check {
  id: string;
  label: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail: string;
  remedy?: string;
}

export async function GET(req: Request) {
  const { account, error } = await requireAccount(req);
  if (error) return error;

  const checks: Check[] = [];
  const token = process.env.META_ACCESS_TOKEN?.trim();
  const adAccountId = account.id;
  const catalogueId = process.env.META_CATALOGUE_ID?.trim() || DEFAULT_CATALOGUE_ID;

  // --- 1. is there a token at all -----------------------------------------
  if (!token) {
    checks.push({
      id: "token",
      label: "Access token",
      status: "FAIL",
      detail: "META_ACCESS_TOKEN is not set.",
      remedy: "Add it to .env and restart the server.",
    });
    return NextResponse.json({ ok: false, checks, mockMode: process.env.USE_MOCK_META !== "false" });
  }

  // --- 2. is it valid, and what can it do ---------------------------------
  let scopes: string[] = [];
  try {
    const debug = await graphGet<{
      data?: { is_valid?: boolean; scopes?: string[]; expires_at?: number; type?: string; app_id?: string };
    }>("debug_token", { input_token: token });
    const d = debug.data ?? {};
    scopes = d.scopes ?? [];
    const expiresAt = d.expires_at ?? 0;
    const neverExpires = expiresAt === 0;
    const expired = !neverExpires && expiresAt * 1000 < Date.now();

    checks.push({
      id: "token",
      label: "Access token",
      status: d.is_valid && !expired ? "PASS" : "FAIL",
      detail: d.is_valid
        ? expired
          ? `Expired on ${new Date(expiresAt * 1000).toLocaleString("en-IN")}.`
          : neverExpires
          ? "Valid, and does not expire — a system user token."
          : `Valid until ${new Date(expiresAt * 1000).toLocaleString("en-IN")}. A short-lived token is fine for a test and useless for anything scheduled.`
        : "Meta reports this token as invalid.",
      remedy: d.is_valid && !expired ? undefined : "Generate a new token and restart the server.",
    });

    // --- 3. scopes -------------------------------------------------------
    // Only ads_management is required. catalog_management affects exactly one
    // button — creating a city product set — and most apps are not approved
    // for it, so its absence is reported as a limitation rather than a
    // failure. Calling it FAIL would say "you cannot publish", which is wrong.
    const hasAds = scopes.includes("ads_management");
    checks.push({
      id: "ads_management",
      label: "ads_management",
      status: hasAds ? "PASS" : "FAIL",
      detail: hasAds
        ? "Granted — campaigns, ad sets, creatives, ads and the page-visitor audience all run on this."
        : "Missing. Nothing can be published without it.",
      remedy: hasAds ? undefined : "Re-generate the token with ads_management ticked.",
    });

    const hasCatalog = scopes.includes("catalog_management");
    checks.push({
      id: "catalog_management",
      label: "catalog_management",
      status: hasCatalog ? "PASS" : "SKIP",
      detail: hasCatalog
        ? "Granted — the app can create a city product set for you."
        : "Not granted. Publishing still works; only the 'Create it in the catalogue' button is unavailable.",
      remedy: hasCatalog
        ? undefined
        : "Create city product sets in Commerce Manager and record the ID, or have the app approved for catalog_management.",
    });

    const hasPages = scopes.includes("pages_manage_ads");
    checks.push({
      id: "pages_manage_ads",
      label: "pages_manage_ads",
      status: hasPages ? "PASS" : "SKIP",
      detail: hasPages
        ? "Granted — the creative can be published as the page."
        : "Not granted. Usually fine when the Page is assigned to the system user; if the creative step fails, this is the first thing to add.",
    });
  } catch {
    // debug_token needs an APP token or a token belonging to an app
    // developer. A system user token is neither, so it cannot introspect
    // itself — Meta returns code 100 here for a perfectly good token.
    // Calling that a failure is wrong, and it was: what actually proves the
    // token works is whether it can reach the ad account, which is checked
    // below. Scopes simply cannot be listed for this kind of token.
    try {
      const me = await graphGet<{ id: string; name?: string }>("me", { fields: "id,name" });
      checks.push({
        id: "token",
        label: "Access token",
        status: "PASS",
        detail: `Valid — system user ${me.name ?? me.id}. Meta will not list a system user token's scopes, so the checks below test real access instead.`,
      });
    } catch (err2) {
      checks.push({
        id: "token",
        label: "Access token",
        status: "FAIL",
        detail: err2 instanceof GraphError ? err2.describe() : String(err2),
        remedy: "The token is malformed, revoked, or from a different app.",
      });
    }
    checks.push({
      id: "scopes",
      label: "Permissions",
      status: "SKIP",
      detail: "Not listable for a system user token. What matters is the access below, which is tested directly.",
    });
  }

  // --- 4. can it reach the ad account -------------------------------------
  try {
    const acct = await graphGet<{ id: string; name: string; currency: string; account_status: number }>(
      `act_${adAccountId}`,
      { fields: "id,name,currency,account_status" }
    );
    checks.push({
      id: "ad_account",
      label: "Ad account",
      status: "PASS",
      detail: `${acct.name} (${acct.id}), ${acct.currency}.`,
    });
  } catch (err) {
    checks.push({
      id: "ad_account",
      label: "Ad account",
      status: "FAIL",
      detail: err instanceof GraphError ? err.describe() : String(err),
      remedy: `The token cannot read ad account ${adAccountId}. Assign the account to the system user in Business Settings.`,
    });
  }

  // --- 5. can it reach the catalogue --------------------------------------
  try {
    const cat = await graphGet<{ id: string; name: string; product_count?: number }>(catalogueId, {
      fields: "id,name,product_count",
    });
    checks.push({
      id: "catalogue",
      label: "Catalogue",
      status: "PASS",
      detail: `${cat.name} (${cat.id})${cat.product_count != null ? `, ${cat.product_count} products` : ""}.`,
    });
  } catch (err) {
    // Reading the catalogue is only needed to create product sets. A publish
    // that uses an existing product set never touches it, so this is reported
    // as a limitation rather than a blocker.
    checks.push({
      id: "catalogue",
      label: "Catalogue",
      status: "SKIP",
      detail: `Cannot read catalogue ${catalogueId}. ${err instanceof GraphError ? err.describe() : String(err)}`,
      remedy:
        "Publishing with an existing product set is unaffected. To create product sets from here, assign the catalogue to the system user and grant catalog_management.",
    });
  }

  // --- 5b. the page and the pixel -----------------------------------------
  // Both are easy to forget when assigning assets, and both fail late: the
  // creative call fails without the page, and the ad set call fails without
  // the pixel. Checking them here turns a mid-publish rollback into a line of
  // text before anything is created.
  // Reading a Page by id needs pages_read_engagement or Page Public Content
  // Access — permissions publishing does not require and rarely has. The
  // question that actually matters is narrower: can this ad account run ads
  // as that page? `promote_pages` answers exactly that, using the ads
  // permission we already have.
  const pageId = process.env.META_PAGE_ID?.trim() || ACCOUNT.pageId;
  try {
    const promotable = await graphGet<{ data: { id: string; name: string }[] }>(
      `act_${adAccountId}/promote_pages`,
      { fields: "id,name", limit: "100" }
    );
    const match = (promotable.data ?? []).find((p) => p.id === pageId);
    if (match) {
      checks.push({
        id: "page",
        label: "Page",
        status: "PASS",
        detail: `${match.name} (${match.id}) — promotable by this ad account, which is what the creative needs.`,
      });
    } else {
      checks.push({
        id: "page",
        label: "Page",
        status: "FAIL",
        detail: `Page ${pageId} is not in this ad account's promotable pages${
          promotable.data?.length ? ` (${promotable.data.length} found)` : ""
        }.`,
        remedy:
          "Assign the Page to the system user in Business settings. The ad creative is published as that page, so step 4 of a publish would fail.",
      });
    }
  } catch (err) {
    checks.push({
      id: "page",
      label: "Page",
      status: "SKIP",
      detail: `Could not list promotable pages. ${err instanceof GraphError ? err.describe() : String(err)}`,
      remedy: "If the creative step fails during a publish, assign the Page to the system user.",
    });
  }

  const pixelId = process.env.META_PIXEL_ID?.trim() || ACCOUNT.pixelId;
  try {
    const pixel = await graphGet<{ id: string; name: string }>(pixelId, { fields: "id,name" });
    checks.push({
      id: "pixel",
      label: "Pixel / dataset",
      status: "PASS",
      detail: `${pixel.name} (${pixel.id}) — the ad set optimises against this dataset.`,
    });
  } catch (err) {
    checks.push({
      id: "pixel",
      label: "Pixel / dataset",
      status: "FAIL",
      detail: err instanceof GraphError ? err.describe() : String(err),
      remedy: `The token cannot use pixel ${pixelId}. Assign the dataset to the system user — the ad set's promoted_object points at it, so without it step 3 of a publish fails.`,
    });
  }

  // --- 6. is live mode actually switched on -------------------------------
  const mock = process.env.USE_MOCK_META !== "false";
  checks.push({
    id: "live_mode",
    label: "Live mode",
    status: mock ? "FAIL" : "PASS",
    detail: mock
      ? "USE_MOCK_META is not set to false, so publishing stays in preview even with a valid token."
      : "Publishing is armed.",
    remedy: mock ? "Set USE_MOCK_META=false in .env and restart." : undefined,
  });

  return NextResponse.json({
    ok: checks.every((c) => c.status !== "FAIL"),
    checks,
    scopes,
    adAccountId,
    catalogueId,
    mockMode: mock,
  });
}
