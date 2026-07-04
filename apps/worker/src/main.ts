import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pino from "pino";
import { loadConfig } from "@dip/config";
import { createDb, sql } from "@dip/db";

/**
 * Worker process skeleton. In Phase 2 this becomes the scheduler/job-control
 * side of the ingestion zone (queue consumers register under src/jobs/).
 * For Phase 1 it boots, validates config and database connectivity, and idles —
 * proving the process split between API and background work.
 */
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, name: "dip-engine-worker" });

const { db, pool } = createDb(config.DATABASE_URL);

try {
  await db.execute(sql`SELECT 1`);
  logger.info("database connection verified");
} catch (err) {
  logger.error({ err }, "database unreachable — worker cannot start");
  await pool.end();
  process.exit(1);
}

logger.info("worker skeleton ready — no jobs registered (jobs arrive in Phase 2)");

const heartbeat = setInterval(() => logger.debug("worker heartbeat"), 60_000);

const shutdown = async (signal: string) => {
  logger.info({ signal }, "shutting down");
  clearInterval(heartbeat);
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
