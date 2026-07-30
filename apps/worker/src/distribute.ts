/**
 * Distribute — rebuild the dashboard serving tables from the clean store.
 * Projects `oliveyoung_global_products` (+ snapshots) into brands, categories,
 * markets, retail_products, products_master, product_ingredients, and
 * voice_pulse_sentiment. Idempotent; safe to run after every ingest.
 *
 *   pnpm distribute
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pino from "pino";
import { loadConfig } from "@dip/config";
import { createDb } from "@dip/db";
import { runDistribute } from "./serving/distribute.js";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, name: "dip-engine-distribute" });

const { db, pool } = createDb(config.DATABASE_URL);

try {
  const results = await runDistribute(db, logger);
  logger.info(results, "distribute complete");
  await pool.end();
  process.exit(0);
} catch (err) {
  logger.error({ err }, "distribute crashed");
  await pool.end();
  process.exit(1);
}
