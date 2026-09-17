// -----------------------------------------------------------------------
// MOCK Meta integration service
// -----------------------------------------------------------------------
// This file simulates Meta Business Manager / Marketing API / Catalogue
// API / Conversions API responses with realistic sample data so the
// product feels fully functional without live Meta credentials.
//
// It is intentionally isolated from client.ts (the real API client stub).
// Nothing in here ever makes a network call. Swap USE_MOCK_META=false and
// supply real credentials in .env to route through client.ts instead —
// see index.ts.
// -----------------------------------------------------------------------
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { metaIntegration } from "@/lib/db/schema";
import type { MetaConnectionStatus, MetaService, MetaBusinessAsset } from "./types";

const SINGLETON_ID = "singleton";

const MOCK_ASSETS = {
  adAccounts: [
    { id: "act_10298374651", name: "Girnar Motors Retail Group", type: "ad_account" as const, meta: { currency: "INR", timezone: "Asia/Kolkata" } },
    { id: "act_10298374652", name: "Girnar Motors — Test Account", type: "ad_account" as const, meta: { currency: "INR", timezone: "Asia/Kolkata" } },
  ],
  pages: [{ id: "pg_5518823", name: "Girnar Motors | Certified Used Cars", type: "page" as const }],
  instagramAccounts: [{ id: "ig_9911223", name: "@girnarmotors", type: "instagram" as const }],
  catalogues: [{ id: "cat_77321098", name: "UsedCars-Master-Catalogue", type: "catalogue" as const, meta: { itemCount: 24580 } }],
  pixels: [{ id: "pxl_44102938", name: "GirnarMotors-WebPixel", type: "pixel" as const }],
};

async function getOrCreateIntegration() {
  const existing = await db.query.metaIntegration.findFirst({ where: eq(metaIntegration.id, SINGLETON_ID) });
  if (existing) return existing;
  await db.insert(metaIntegration).values({ id: SINGLETON_ID }).onConflictDoNothing();
  return (await db.query.metaIntegration.findFirst({ where: eq(metaIntegration.id, SINGLETON_ID) }))!;
}

function toStatus(row: typeof metaIntegration.$inferSelect): MetaConnectionStatus {
  return {
    connected: row.connected,
    businessManager: row.businessManager ?? undefined,
    adAccountId: row.adAccountId ?? undefined,
    adAccountName: row.adAccountName ?? undefined,
    pageId: row.pageId ?? undefined,
    pageName: row.pageName ?? undefined,
    igAccountId: row.igAccountId ?? undefined,
    igUsername: row.igUsername ?? undefined,
    catalogueId: row.catalogueId ?? undefined,
    catalogueName: row.catalogueName ?? undefined,
    pixelId: row.pixelId ?? undefined,
    capiEnabled: row.capiEnabled,
    connectedAt: row.connectedAt?.toISOString(),
  };
}

export const mockMetaService: MetaService = {
  mode: "mock",

  async getConnectionStatus(): Promise<MetaConnectionStatus> {
    return toStatus(await getOrCreateIntegration());
  },

  async listAvailableAssets() {
    return MOCK_ASSETS as unknown as {
      adAccounts: MetaBusinessAsset[];
      pages: MetaBusinessAsset[];
      instagramAccounts: MetaBusinessAsset[];
      catalogues: MetaBusinessAsset[];
      pixels: MetaBusinessAsset[];
    };
  },

  async connect(selection) {
    const adAccount = MOCK_ASSETS.adAccounts.find((a) => a.id === selection.adAccountId);
    const page = MOCK_ASSETS.pages.find((a) => a.id === selection.pageId);
    const ig = MOCK_ASSETS.instagramAccounts.find((a) => a.id === selection.igAccountId);
    const catalogue = MOCK_ASSETS.catalogues.find((a) => a.id === selection.catalogueId);

    await getOrCreateIntegration();
    await db
      .update(metaIntegration)
      .set({
        connected: true,
        businessManager: selection.businessManager,
        adAccountId: selection.adAccountId,
        adAccountName: adAccount?.name,
        pageId: selection.pageId,
        pageName: page?.name,
        igAccountId: selection.igAccountId,
        igUsername: ig?.name,
        catalogueId: selection.catalogueId,
        catalogueName: catalogue?.name,
        pixelId: selection.pixelId,
        capiEnabled: true,
        connectedAt: new Date(),
      })
      .where(eq(metaIntegration.id, SINGLETON_ID));

    return toStatus((await db.query.metaIntegration.findFirst({ where: eq(metaIntegration.id, SINGLETON_ID) }))!);
  },

  async disconnect() {
    await getOrCreateIntegration();
    await db.update(metaIntegration).set({ connected: false }).where(eq(metaIntegration.id, SINGLETON_ID));
  },

  async syncPerformance() {
    // In mock mode "syncing" just means the demo data already seeded is
    // treated as up to date. In live mode this calls the Meta Insights API.
    return { synced: true, rowsSynced: 0, syncedAt: new Date().toISOString() };
  },
};
