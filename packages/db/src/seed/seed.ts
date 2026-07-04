/**
 * Idempotent Phase 2 seed: registers the approved ingestion source.
 * Safe to re-run — upserts by slug. Run via `pnpm db:seed` (after `pnpm build`).
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { loadConfig } from "@dip/config";
import { createDb } from "../client.js";
import { sources } from "../schema/ingestion.js";

loadEnv({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);

// Approved Phase 2 source. Seed URLs contain ONLY the approved homepage;
// approved category/product URLs are added later via UPDATE when provided.
const OLIVE_YOUNG_GLOBAL = {
  name: "Olive Young Global",
  slug: "oliveyoung-global",
  baseUrl: "https://global.oliveyoung.com/",
  sourceType: "marketplace",
  enabled: true,
  seedUrls: ["https://global.oliveyoung.com/"],
  scrapeStrategy: "Static HTML fetch of seed URLs (Phase 2). Dynamic rendering evaluated later.",
  notes: "Approved Phase 2 source; max 5 seed URLs fetched per job (application rule).",
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
      notes: OLIVE_YOUNG_GLOBAL.notes,
      updatedAt: new Date(),
    },
  });

console.log(`seeded source '${OLIVE_YOUNG_GLOBAL.slug}'`);
await pool.end();
