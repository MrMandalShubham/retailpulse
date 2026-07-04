/**
 * One-shot Phase 3 transform run (manual trigger — no scheduler/queue yet):
 * eligible raw documents → hybrid extraction/normalization → staged_products
 * + transform_observations. Never writes to the canonical 8-table core.
 *
 * Usage:
 *   pnpm transform:run                 process unprocessed documents only
 *   pnpm transform:run -- --reprocess  regenerate staging for eligible docs
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pino from "pino";
import { getSpacesConfig, loadConfig } from "@dip/config";
import { createDb } from "@dip/db";
import { createSpacesStorage } from "@dip/storage";
import { runTransformCycle } from "./pipeline.js";
import { createTransformRepo } from "./repo.js";

loadEnv({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });

const config = loadConfig();
const spaces = getSpacesConfig(config);
const logger = pino({ level: config.LOG_LEVEL, name: "dip-engine-transform" });
const reprocess = process.argv.includes("--reprocess");

const { db, pool } = createDb(config.DATABASE_URL);

try {
  const summary = await runTransformCycle({
    repo: createTransformRepo(db),
    storage: createSpacesStorage(spaces),
    logger,
    maxDocuments: config.TRANSFORM_MAX_DOCUMENTS,
    reprocess,
  });
  logger.info(summary, "transform cycle complete");
  await pool.end();
  process.exit(summary.totalDocuments > 0 && summary.succeededDocuments === 0 ? 1 : 0);
} catch (err) {
  logger.error({ err }, "transform cycle crashed");
  await pool.end();
  process.exit(1);
}
