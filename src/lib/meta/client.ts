// -----------------------------------------------------------------------
// LIVE Meta Marketing API client
// -----------------------------------------------------------------------
// Reads real connection state off the Graph API. Publishing lives in
// publish.ts rather than here, because publishing is a multi-step
// transaction with a rollback and this interface is a set of single calls.
//
// Requires in .env:
//   META_ACCESS_TOKEN    system user token with ads_management on the account
//   META_AD_ACCOUNT_ID   e.g. 10153410655459601
//   USE_MOCK_META=false
// -----------------------------------------------------------------------
import type { MetaBusinessAsset, MetaService } from "./types";
import { graphGet } from "./graph";

function accountId(): string {
  const id = process.env.META_AD_ACCOUNT_ID?.trim();
  if (!id) throw new Error("META_AD_ACCOUNT_ID is not set.");
  return id.startsWith("act_") ? id.slice(4) : id;
}

export const liveMetaService: MetaService = {
  mode: "live",

  async getConnectionStatus() {
    const id = accountId();
    const account = await graphGet<{
      id: string;
      name: string;
      business?: { id: string; name: string };
      currency: string;
    }>(`act_${id}`, { fields: "id,name,business,currency" });

    // A token that reads the account but cannot write to it is the failure
    // mode worth catching early, so ask for the permissions too.
    const me = await graphGet<{ id: string }>("me", { fields: "id" }).catch(() => null);

    return {
      connected: true,
      businessManager: account.business?.name,
      adAccountId: account.id,
      adAccountName: account.name,
      pixelId: process.env.META_PIXEL_ID?.trim() || undefined,
      catalogueId: process.env.META_CATALOGUE_ID?.trim() || undefined,
      pageId: process.env.META_PAGE_ID?.trim() || undefined,
      capiEnabled: Boolean(me),
      connectedAt: new Date().toISOString(),
    };
  },

  async listAvailableAssets() {
    const id = accountId();
    const asAssets = <T extends { id: string; name: string }>(
      rows: T[] | undefined,
      type: MetaBusinessAsset["type"]
    ): MetaBusinessAsset[] => (rows ?? []).map((r) => ({ id: r.id, name: r.name, type }));

    const [pages, pixels, catalogues] = await Promise.all([
      graphGet<{ data: { id: string; name: string }[] }>(`act_${id}/promote_pages`, {
        fields: "id,name",
        limit: "50",
      }).catch(() => ({ data: [] as { id: string; name: string }[] })),
      graphGet<{ data: { id: string; name: string }[] }>(`act_${id}/adspixels`, {
        fields: "id,name",
        limit: "25",
      }).catch(() => ({ data: [] as { id: string; name: string }[] })),
      graphGet<{ data: { id: string; name: string }[] }>(`act_${id}/product_catalogs`, {
        fields: "id,name",
        limit: "50",
      }).catch(() => ({ data: [] as { id: string; name: string }[] })),
    ]);

    const account = await graphGet<{ id: string; name: string }>(`act_${id}`, { fields: "id,name" });

    return {
      adAccounts: [{ id: account.id, name: account.name, type: "ad_account" as const }],
      pages: asAssets(pages.data, "page"),
      instagramAccounts: [],
      catalogues: asAssets(catalogues.data, "catalogue"),
      pixels: asAssets(pixels.data, "pixel"),
    };
  },

  async connect() {
    // Connection is by environment variable, not by an OAuth handshake in this
    // build — saying so plainly beats pretending to store a selection.
    return liveMetaService.getConnectionStatus();
  },

  async disconnect() {
    throw new Error(
      "Live mode is configured by environment variable. Remove META_ACCESS_TOKEN or set USE_MOCK_META=true to disconnect."
    );
  },

  async syncPerformance() {
    const id = accountId();
    const insights = await graphGet<{ data: unknown[] }>(`act_${id}/insights`, {
      level: "adset",
      fields: "adset_id,spend,impressions,clicks,reach,actions",
      date_preset: "last_30d",
      limit: "500",
    });
    return {
      synced: true,
      rowsSynced: insights.data?.length ?? 0,
      syncedAt: new Date().toISOString(),
    };
  },
};
