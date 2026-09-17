import { mockMetaService } from "./mock";
import { liveMetaService } from "./client";
import type { MetaService } from "./types";

const useMock = process.env.USE_MOCK_META !== "false";

export const metaService: MetaService = useMock ? mockMetaService : liveMetaService;
export * from "./types";
