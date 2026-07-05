/**
 * One-shot canonical promotion batch (manual trigger, same gateway as the
 * API's POST /promotion/run): eligible staged products → @dip/promotion →
 * canonical tables with full audit trail. Usage: pnpm promote:run
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pino from "pino";
import { loadConfig } from "@dip/config";
import { createDb } from "@dip/db";
import { createPromotionService } from "@dip/promotion";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, name: "dip-engine-promote" });
const { db, pool } = createDb(config.DATABASE_URL);

try {
  const service = createPromotionService(db);
  const summary = await service.runBatch(config.PROMOTION_MAX_ITEMS);
  logger.info(
    {
      runId: summary.runId,
      totalItems: summary.totalItems,
      promotedNew: summary.promotedNew,
      matchedExisting: summary.matchedExisting,
      skipped: summary.skipped,
      failed: summary.failed,
    },
    "promotion batch complete",
  );
  for (const outcome of summary.outcomes) {
    logger.info(outcome, "promotion outcome");
  }
  await pool.end();
  process.exit(0);
} catch (err) {
  logger.error({ err }, "promotion batch crashed");
  await pool.end();
  process.exit(1);
}
