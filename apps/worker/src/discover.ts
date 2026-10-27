/**
 * Phase 0 — product discovery CLI (sitemap + category-crawl, deterministic).
 *   pnpm discover:run    discover + map product pages into discovered_product_pages
 *
 * Thin by design: discovers and maps only. The clean flow's `ingest:api` reads
 * pending map rows directly (no seed_urls hand-off).
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pino from "pino";
import { loadConfig } from "@dip/config";
import { createDb } from "@dip/db";
import { postJsonDefault } from "./discovery/category.js";
import { runDiscoveryCycle } from "./discovery/pipeline.js";
import { createDiscoveryRepo } from "./discovery/repo.js";
import { fetchTextDefault } from "./discovery/sitemap.js";
import { fetchUrl } from "./ingestion/fetcher.js";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, name: "dip-engine-discover" });
const { db, pool } = createDb(config.DATABASE_URL);

// Optional source-slug filter: `pnpm discover:run cosme-jp` maps only that
// source. (The npm script forwards a literal "run" token, so ignore it + flags.)
const onlySlug = process.argv.slice(2).find((a) => a !== "run" && !a.startsWith("-"));

try {
  const repo = createDiscoveryRepo(db);
  const summaries = await runDiscoveryCycle({
    repo,
    fetchText: (url) => fetchTextDefault(url, config.INGEST_FETCH_TIMEOUT_MS),
    postJson: (url, body) => postJsonDefault(url, body, config.INGEST_FETCH_TIMEOUT_MS),
    fetchBytes: async (url, userAgent) => {
      const res = await fetchUrl(url, {
        timeoutMs: config.INGEST_FETCH_TIMEOUT_MS,
        retries: 2,
        userAgent,
      });
      return res.ok && res.body ? res.body : null;
    },
    logger,
    onlySlug,
  });
  logger.info({ summaries }, "discovery cycle complete");
  await pool.end();
  process.exit(0);
} catch (err) {
  logger.error({ err }, "discovery command failed");
  await pool.end();
  process.exit(1);
}
