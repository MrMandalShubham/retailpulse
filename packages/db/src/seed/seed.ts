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

// @cosme (アットコスメ) — the approved Japan source. Discovery crawls each
// category's paginated ranking listing (server-rendered Shift_JIS HTML) for
// /products/{id}/ links; Phase 1 ingest:api fetches each product page, parses
// JSON-LD + the Shift_JIS info block, and translates JA→EN via Mistral.
const COSME_JP = {
  name: "@cosme (Japan)",
  slug: "cosme-jp",
  baseUrl: "https://www.cosme.net/",
  sourceType: "marketplace",
  enabled: true,
  seedUrls: ["https://www.cosme.net/"],
  scrapeStrategy: "HTML + JSON-LD ingestion (see playbooks/cosme-jp.ingestion.md).",
  discoveryConfig: {
    strategy: "pagination",
    listingUrlTemplate: "https://www.cosme.net/categories/item/{cat}/ranking/?page={page}",
    productUrlBase: "https://www.cosme.net/products/",
    productIdRegex: "/products/(\\d+)/",
    charset: "shift_jis",
    // Leaf categories across skincare + makeup (see cosme-jp.discovery.md).
    categoryNos: [
      "900", "901", "902", "1004", "1006", "904", "1037",
      "910", "911", "912", "1015", "914", "916", "920",
    ],
    maxPagesPerCategory: 4, // ~13 products/page × 4 × 14 cats ≈ 500 discovered (dedup)
  },
  notes: "Approved Japan source. Review aggregator (no storefront) — price is a JPY reference price and often absent.",
};

for (const src of [OLIVE_YOUNG_GLOBAL, COSME_JP]) {
  await db
    .insert(sources)
    .values(src)
    .onConflictDoUpdate({
      target: sources.slug,
      set: {
        name: src.name,
        baseUrl: src.baseUrl,
        sourceType: src.sourceType,
        enabled: src.enabled,
        seedUrls: src.seedUrls,
        scrapeStrategy: src.scrapeStrategy,
        discoveryConfig: src.discoveryConfig,
        notes: src.notes,
        updatedAt: new Date(),
      },
    });
  console.log(`seeded source '${src.slug}'`);
}

await pool.end();
process.exit(0);
