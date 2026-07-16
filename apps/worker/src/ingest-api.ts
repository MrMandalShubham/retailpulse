/**
 * Phase 1 — one-shot API ingestion for Olive Young (manual trigger).
 * Reads `pending` products from the Phase 0 map, fetches each product's raw
 * JSON envelope (detail-data + details-info + review-summary), stores it
 * UNCOMPRESSED in object storage, records a raw_documents pointer, and marks
 * the map row ingested.
 *
 *   pnpm ingest:api [sourceSlug] [limit]   (defaults: oliveyoung-global 3)
 *
 * Gzip is deliberately NOT applied here — raw stays readable through the flow;
 * compression is a separate end-of-flow step.
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pino from "pino";
import { getSpacesConfig, loadConfig } from "@dip/config";
import { createDb } from "@dip/db";
import { createSpacesStorage } from "@dip/storage";
import { createApiIngestionRepo, runApiIngestionCycle } from "./ingestion/api-pipeline.js";
import { defaultGetHtml, defaultPostJson, fetchOliveYoungProduct } from "./ingestion/oliveyoung.js";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = loadConfig();
const spaces = getSpacesConfig(config);
const logger = pino({ level: config.LOG_LEVEL, name: "dip-engine-ingest-api" });

const slug = process.argv[2] ?? "oliveyoung-global";
const parsedLimit = Number.parseInt(process.argv[3] ?? "3", 10);
const maxProducts = Number.isFinite(parsedLimit) ? parsedLimit : 3;

const { db, pool } = createDb(config.DATABASE_URL);
const storage = createSpacesStorage(spaces);
const repo = createApiIngestionRepo(db);

try {
  const summary = await runApiIngestionCycle({
    repo,
    storage,
    fetchProduct: (productId, productUrl) =>
      fetchOliveYoungProduct(productId, productUrl, slug, {
        postJson: (url, body) => defaultPostJson(url, body, config.INGEST_FETCH_TIMEOUT_MS),
        getHtml: (url) => defaultGetHtml(url, config.INGEST_FETCH_TIMEOUT_MS),
      }),
    logger,
    sourceSlug: slug,
    maxProducts,
    interRequestDelayMs: 500,
  });
  logger.info(summary, "api ingestion cycle complete");
  await pool.end();
  process.exit(summary.status === "failed" ? 1 : 0);
} catch (err) {
  logger.error({ err }, "api ingestion cycle crashed");
  await pool.end();
  process.exit(1);
}
