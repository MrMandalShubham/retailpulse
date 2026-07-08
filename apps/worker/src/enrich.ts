/**
 * One-shot Phase 7 enrichment (manual trigger): fills beauty-product
 * attributes on canonical products — deterministic (SPF/PA/size/texture/domain)
 * applied fill-if-null, heuristic (price_segment) proposed for review. Every
 * attempt is recorded with provenance; un-derivable fields stay null with a
 * reason. Never overwrites, never fabricates. Usage: pnpm enrich:run
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pino from "pino";
import { loadConfig } from "@dip/config";
import { createDb } from "@dip/db";
import { createEnrichmentRepo, runEnrichmentCycle } from "@dip/enrichment";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, name: "dip-engine-enrich" });
const { db, pool } = createDb(config.DATABASE_URL);

try {
  const summary = await runEnrichmentCycle({
    repo: createEnrichmentRepo(db),
    logger,
    maxProducts: config.ENRICH_MAX_PRODUCTS,
  });
  logger.info(summary, "enrichment cycle complete");
  await pool.end();
  process.exit(0);
} catch (err) {
  logger.error({ err }, "enrichment cycle crashed");
  await pool.end();
  process.exit(1);
}
