/**
 * Idempotent seed for the clean DIP: the approved ingestion source
 * (oliveyoung-global) with its Phase 0 discovery_config. Safe to re-run —
 * sources upsert by slug. Run via `pnpm db:seed` (after `pnpm build`).
 *
 * The middle chain (markets, normalization rules, source-market mappings) was
 * retired, so this seed now only bootstraps the source the discover → ingest →
 * platform-load flow needs.
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { loadConfig } from "@dip/config";
import { createDb } from "../client.js";
import { sources } from "../schema/ingestion.js";

loadEnv({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);

// Olive Young Global — the approved source. Phase 0 discovery_config drives the
// category-crawl map; Phase 1 ingest:api reads the resulting pending pages.
const OLIVE_YOUNG_GLOBAL = {
  name: "Olive Young Global",
  slug: "oliveyoung-global",
  baseUrl: "https://global.oliveyoung.com/",
  sourceType: "marketplace",
  enabled: true,
  seedUrls: ["https://global.oliveyoung.com/"],
  scrapeStrategy: "Direct API ingestion (see playbooks/oliveyoung-global.ingestion.md).",
  discoveryConfig: {
    strategy: "category_crawl",
    categoryApiUrl: "https://global.oliveyoung.com/display/category/product-data/",
    categoryNos: [
      "1000000008", "1000000031", "1000000052", "1000000070", "1000000003",
      "1000000011", "1000000162", "1000000087", "1000000083", "1000000095",
      "1000000119", "1000000134", "1000000137", "1000000151",
    ],
    productUrlBase: "https://global.oliveyoung.com/product/detail?prdtNo=",
    rowsPerPage: 100,
  },
  notes: "Approved source. Discovery via category API; ingestion via product JSON APIs.",
};

await db
  .insert(sources)
  .values(OLIVE_YOUNG_GLOBAL)
  .onConflictDoUpdate({
    target: sources.slug,
    set: {
      name: OLIVE_YOUNG_GLOBAL.name,
      baseUrl: OLIVE_YOUNG_GLOBAL.baseUrl,
      sourceType: OLIVE_YOUNG_GLOBAL.sourceType,
      enabled: OLIVE_YOUNG_GLOBAL.enabled,
      seedUrls: OLIVE_YOUNG_GLOBAL.seedUrls,
      scrapeStrategy: OLIVE_YOUNG_GLOBAL.scrapeStrategy,
      discoveryConfig: OLIVE_YOUNG_GLOBAL.discoveryConfig,
      notes: OLIVE_YOUNG_GLOBAL.notes,
      updatedAt: new Date(),
    },
  });
console.log(`seeded source '${OLIVE_YOUNG_GLOBAL.slug}'`);

await pool.end();
process.exit(0);
