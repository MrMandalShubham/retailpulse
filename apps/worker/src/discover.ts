/**
 * Phase 0a — product discovery CLI (sitemap-first, deterministic).
 *   pnpm discover:run                       discover + map product URLs
 *   pnpm discover:batch <sourceSlug> [n]    queue up to n confirmed pages into seed_urls
 *   pnpm discover:backfill                   link discovered pages to canonical products
 *
 * Thin by design: discovers and maps only. Handoff is the existing
 * sources.seed_urls; the render/ingest pipeline is unchanged.
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pino from "pino";
import { loadConfig } from "@dip/config";
import { createDb } from "@dip/db";
import { runDiscoveryCycle } from "./discovery/pipeline.js";
import { backfillCanonical, batchToSeedUrls, createDiscoveryRepo } from "./discovery/repo.js";
import { fetchTextDefault } from "./discovery/sitemap.js";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const mode = process.argv[2] ?? "run";
const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, name: "dip-engine-discover" });
const { db, pool } = createDb(config.DATABASE_URL);

try {
  if (mode === "run") {
    const repo = createDiscoveryRepo(db);
    const summaries = await runDiscoveryCycle({
      repo,
      fetchText: (url) => fetchTextDefault(url, config.INGEST_FETCH_TIMEOUT_MS),
      logger,
    });
    logger.info({ summaries }, "discovery cycle complete");
  } else if (mode === "backfill") {
    const backfilled = await backfillCanonical(db);
    logger.info({ backfilled }, "canonical backfill complete");
  } else if (mode === "batch") {
    const slug = process.argv[3];
    const limit = Number.parseInt(process.argv[4] ?? "50", 10);
    if (!slug) throw new Error("usage: discover batch <sourceSlug> [limit]");
    // Link already-promoted pages first so they aren't re-queued.
    const backfilled = await backfillCanonical(db);
    const res = await batchToSeedUrls(db, slug, Number.isFinite(limit) ? limit : 50);
    logger.info(
      { slug, backfilled, queued: res.queued, sourceFound: res.sourceId !== null },
      "discovery batch complete",
    );
  } else {
    throw new Error(`unknown mode '${mode}' (expected run | batch | backfill)`);
  }
  await pool.end();
  process.exit(0);
} catch (err) {
  logger.error({ err }, "discovery command failed");
  await pool.end();
  process.exit(1);
}
