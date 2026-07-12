/**
 * One-shot Phase 2 ingestion run (manual trigger — no scheduler/queue yet):
 * reads enabled sources, fetches their seed URLs, stores raw payloads in
 * object storage, records raw_documents, and exits.
 * Run via `pnpm ingest:run` from the repo root.
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pino from "pino";
import { getSpacesConfig, loadConfig } from "@dip/config";
import { createDb } from "@dip/db";
import { createSpacesStorage } from "@dip/storage";
import { fetchUrl } from "./ingestion/fetcher.js";
import { runIngestionCycle } from "./ingestion/pipeline.js";
import { createIngestionRepo } from "./ingestion/repo.js";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = loadConfig();
const spaces = getSpacesConfig(config);
const logger = pino({ level: config.LOG_LEVEL, name: "dip-engine-ingest" });

const { db, pool } = createDb(config.DATABASE_URL);
const storage = createSpacesStorage(spaces);
const repo = createIngestionRepo(db);

try {
  const summary = await runIngestionCycle({
    repo,
    storage,
    fetchUrl: (url) => fetchUrl(url, { timeoutMs: config.INGEST_FETCH_TIMEOUT_MS }),
    logger,
    interRequestDelayMs: 1_000,
    maxSeedUrls: config.INGEST_MAX_SEED_URLS,
  });
  logger.info(summary, "ingestion cycle complete");
  await pool.end();
  // Non-zero exit only when the cycle produced nothing but failures.
  const totalJobs = summary.jobsSucceeded + summary.jobsFailed;
  process.exit(totalJobs > 0 && summary.jobsSucceeded === 0 ? 1 : 0);
} catch (err) {
  logger.error({ err }, "ingestion cycle crashed");
  await pool.end();
  process.exit(1);
}
