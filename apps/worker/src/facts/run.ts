/**
 * One-shot Phase 6 fact extraction (manual trigger): promoted evidence →
 * append-only price/rating facts (+ market-gated core rollups). DB-only,
 * deterministic, idempotent via the (product, source_url, observed_at)
 * dedup anchor. Usage: pnpm facts:run
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pino from "pino";
import { loadConfig } from "@dip/config";
import { createDb } from "@dip/db";
import { runFactCycle } from "./pipeline.js";
import { createFactRepo } from "./repo.js";

loadEnv({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, name: "dip-engine-facts" });
const { db, pool } = createDb(config.DATABASE_URL);

try {
  const summary = await runFactCycle({
    repo: createFactRepo(db),
    logger,
    maxProducts: config.FACTS_MAX_PRODUCTS,
  });
  logger.info(summary, "fact cycle complete");
  await pool.end();
  process.exit(0);
} catch (err) {
  logger.error({ err }, "fact cycle crashed");
  await pool.end();
  process.exit(1);
}
