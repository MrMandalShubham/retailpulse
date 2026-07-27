/**
 * Phase 1 — fetch + clean in one pass (manual trigger).
 * Reads `pending` products from the Phase 0 map, fetches each product's API
 * envelope IN MEMORY (detail-data + details-info + review-summary), transforms
 * it straight into the clean per-platform store + a daily snapshot, and marks
 * the map row ingested. No object storage, no raw layer — the clean table is
 * the end product.
 *
 *   pnpm ingest:api [sourceSlug] [limit]   (defaults: oliveyoung-global 3)
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pino from "pino";
import { loadConfig } from "@dip/config";
import { createDb } from "@dip/db";
import { createSyncRepo, runSyncCycle } from "./ingestion/api-pipeline.js";
import { defaultPostJson, fetchOliveYoungProduct } from "./ingestion/oliveyoung.js";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, name: "dip-engine-ingest-api" });

const slug = process.argv[2] ?? "oliveyoung-global";
const parsedLimit = Number.parseInt(process.argv[3] ?? "3", 10);
const maxProducts = Number.isFinite(parsedLimit) ? parsedLimit : 3;

const { db, pool } = createDb(config.DATABASE_URL);
const repo = createSyncRepo(db);

try {
  const summary = await runSyncCycle({
    repo,
    fetchProduct: (productId, productUrl) =>
      fetchOliveYoungProduct(productId, productUrl, slug, {
        postJson: (url, body) => defaultPostJson(url, body, config.INGEST_FETCH_TIMEOUT_MS),
      }),
    logger,
    sourceSlug: slug,
    maxProducts,
    interRequestDelayMs: 500,
  });
  logger.info(summary, "ingest cycle complete");
  await pool.end();
  process.exit(summary.status === "failed" ? 1 : 0);
} catch (err) {
  logger.error({ err }, "ingest cycle crashed");
  await pool.end();
  process.exit(1);
}
