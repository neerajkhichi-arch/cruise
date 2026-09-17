// Shared types for the Meta integration layer.
// Both the mock service (mock.ts) and the real client stub (client.ts)
// implement this interface, so the rest of the app never needs to know
// which one is active — see index.ts for the routing logic.

export interface MetaConnectionStatus {
  connected: boolean;
  businessManager?: string;
  adAccountId?: string;
  adAccountName?: string;
  pageId?: string;
  pageName?: string;
  igAccountId?: string;
  igUsername?: string;
  catalogueId?: string;
  catalogueName?: string;
  pixelId?: string;
  capiEnabled?: boolean;
  connectedAt?: string;
}

export interface MetaBusinessAsset {
  id: string;
  name: string;
  type: "ad_account" | "page" | "instagram" | "catalogue" | "pixel";
  meta?: Record<string, string | number>;
}

export interface MetaService {
  mode: "mock" | "live";
  getConnectionStatus(): Promise<MetaConnectionStatus>;
  listAvailableAssets(): Promise<{
    adAccounts: MetaBusinessAsset[];
    pages: MetaBusinessAsset[];
    instagramAccounts: MetaBusinessAsset[];
    catalogues: MetaBusinessAsset[];
    pixels: MetaBusinessAsset[];
  }>;
  connect(selection: {
    businessManager: string;
    adAccountId: string;
    pageId: string;
    igAccountId: string;
    catalogueId: string;
    pixelId: string;
  }): Promise<MetaConnectionStatus>;
  disconnect(): Promise<void>;
  syncPerformance(): Promise<{ synced: boolean; rowsSynced: number; syncedAt: string }>;
}
