/**
 * Phase 1 — fetch + clean in one pass (manual trigger).
 * Reads `pending` products from the Phase 0 map, fetches each product's data IN
 * MEMORY, transforms it straight into the clean per-platform store + a daily
 * snapshot, and marks the map row ingested. No object storage, no raw layer —
 * the clean table is the end product.
 *
 * Dispatches by source slug:
 *   - oliveyoung-global : JSON APIs (detail-data + details-info + review-summary)
 *   - cosme-jp          : HTML + JSON-LD, with Mistral JA→EN translation at ingest
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
import { createCosmeSyncRepo, runCosmeSyncCycle } from "./ingestion/cosme-pipeline.js";
import { fetchCosmeProduct } from "./ingestion/cosme.js";
import { fetchUrl } from "./ingestion/fetcher.js";
import { createMistralTranslator } from "./platform/translate.js";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, name: "dip-engine-ingest-api" });

const slug = process.argv[2] ?? "oliveyoung-global";
const parsedLimit = Number.parseInt(process.argv[3] ?? "3", 10);
const maxProducts = Number.isFinite(parsedLimit) ? parsedLimit : 3;

const { db, pool } = createDb(config.DATABASE_URL);

async function run(): Promise<"succeeded" | "failed" | "skipped"> {
  if (slug === "cosme-jp") {
    if (!config.MISTRAL_API_KEY) {
      logger.error({}, "cosme-jp ingest needs MISTRAL_API_KEY (JA→EN translation) — aborting");
      return "failed";
    }
    const translator = createMistralTranslator({
      apiKey: config.MISTRAL_API_KEY,
      model: config.AI_MODEL,
      timeoutMs: config.INGEST_FETCH_TIMEOUT_MS,
      logger,
    });
    const summary = await runCosmeSyncCycle({
      repo: createCosmeSyncRepo(db),
      fetchProduct: (productId, productUrl) =>
        fetchCosmeProduct(productId, productUrl, slug, {
          fetchBytes: async (url, userAgent) => {
            const r = await fetchUrl(url, {
              timeoutMs: config.INGEST_FETCH_TIMEOUT_MS,
              retries: 2,
              userAgent,
            });
            return { bytes: r.ok && r.body ? r.body : null, status: r.httpStatus ?? 0 };
          },
        }),
      translator,
      logger,
      sourceSlug: slug,
      maxProducts,
      interRequestDelayMs: 600,
    });
    logger.info(summary, "ingest cycle complete");
    return summary.status;
  }

  const summary = await runSyncCycle({
    repo: createSyncRepo(db),
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
  return summary.status;
}

try {
  const status = await run();
  await pool.end();
  process.exit(status === "failed" ? 1 : 0);
} catch (err) {
  logger.error({ err }, "ingest cycle crashed");
  await pool.end();
  process.exit(1);
}
