/**
 * Phase 10 — one-shot browser-render ingestion for JS-rendered sources.
 * Same pipeline as `ingest:run` (crawl job -> object storage -> raw_documents),
 * but the fetcher is a headless Chromium that renders the page and emits a
 * JSON-LD Product document. The existing transform -> promote -> facts -> enrich
 * pipeline then runs unchanged.
 *
 * Run via `pnpm render:run` from the repo root. Requires the Playwright browser:
 *   pnpm --filter @dip/worker exec playwright install chromium
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pino from "pino";
import { getSpacesConfig, loadConfig } from "@dip/config";
import { createDb } from "@dip/db";
import { createSpacesStorage } from "@dip/storage";
import { runIngestionCycle } from "./ingestion/pipeline.js";
import { createIngestionRepo } from "./ingestion/repo.js";
import { createRenderer } from "./render/browser.js";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = loadConfig();
const spaces = getSpacesConfig(config);
const logger = pino({ level: config.LOG_LEVEL, name: "dip-engine-render" });

const { db, pool } = createDb(config.DATABASE_URL);
const storage = createSpacesStorage(spaces);
const repo = createIngestionRepo(db);
const headless = process.env.RENDER_HEADLESS !== "false";
const renderer = await createRenderer({ headless });

try {
  logger.info({ headless }, "browser renderer started");
  const summary = await runIngestionCycle({
    repo,
    storage,
    fetchUrl: (url) => renderer.renderUrl(url),
    logger,
    // Politeness: browser render is heavier; keep a real gap between pages.
    interRequestDelayMs: 1_500,
    maxSeedUrls: config.INGEST_MAX_SEED_URLS,
  });
  logger.info(summary, "render cycle complete");
  await renderer.close();
  await pool.end();
  const totalJobs = summary.jobsSucceeded + summary.jobsFailed;
  process.exit(totalJobs > 0 && summary.jobsSucceeded === 0 ? 1 : 0);
} catch (err) {
  logger.error({ err }, "render cycle crashed");
  await renderer.close().catch(() => undefined);
  await pool.end();
  process.exit(1);
}
