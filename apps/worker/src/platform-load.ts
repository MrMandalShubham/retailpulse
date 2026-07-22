/**
 * Clean-load the Olive Young per-platform store from the Phase 1 raw envelopes.
 * Transforms each envelope into a clean typed row in oliveyoung_global_products.
 *
 *   pnpm platform:load [limit]     (default: all envelopes)
 *
 * Idempotent — re-running refreshes existing rows on product_id.
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pino from "pino";
import { getSpacesConfig, loadConfig } from "@dip/config";
import { createDb } from "@dip/db";
import { createSpacesStorage } from "@dip/storage";
import { runOliveYoungCleanLoad } from "./platform/pipeline.js";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = loadConfig();
const spaces = getSpacesConfig(config);
const logger = pino({ level: config.LOG_LEVEL, name: "dip-engine-platform-load" });

const parsed = Number.parseInt(process.argv[2] ?? "1000000", 10);
const limit = Number.isFinite(parsed) ? parsed : 1_000_000;

const { db, pool } = createDb(config.DATABASE_URL);
const storage = createSpacesStorage(spaces);

try {
  const summary = await runOliveYoungCleanLoad({ db, storage, logger, limit });
  logger.info(summary, "platform clean-load cycle complete");
  await pool.end();
  process.exit(summary.considered > 0 && summary.upserted === 0 ? 1 : 0);
} catch (err) {
  logger.error({ err }, "platform clean-load crashed");
  await pool.end();
  process.exit(1);
}
