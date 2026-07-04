/**
 * One-shot Phase 4 AI review run (manual trigger — no scheduler/queue):
 * gated leftovers → configured provider (AI_PROVIDER: mock by default,
 * mistral when configured) → ai_review_items + ai_rule_suggestions.
 * Advisory only: normalization_rules changes ONLY via the approval endpoint;
 * canonical tables are never touched.
 *
 * Usage: pnpm ai-review:run
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pino from "pino";
import { getAiConfig, loadConfig } from "@dip/config";
import { createDb } from "@dip/db";
import { createAIReviewProvider } from "@dip/ai";
import { runAiReviewCycle } from "./pipeline.js";
import { createAiReviewRepo } from "./repo.js";

loadEnv({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });

const config = loadConfig();
const ai = getAiConfig(config);
const logger = pino({ level: config.LOG_LEVEL, name: "dip-engine-ai-review" });

const { db, pool } = createDb(config.DATABASE_URL);

try {
  const provider = createAIReviewProvider({
    provider: ai.provider,
    model: ai.model,
    apiKey: ai.apiKey,
    timeoutMs: ai.timeoutMs,
    maxRetries: ai.maxRetries,
  });
  const summary = await runAiReviewCycle({
    repo: createAiReviewRepo(db),
    provider,
    logger,
    maxItems: ai.maxItems,
  });
  logger.info(summary, "ai review cycle complete");
  await pool.end();
  process.exit(summary.totalItems > 0 && summary.succeededItems === 0 ? 1 : 0);
} catch (err) {
  logger.error({ err }, "ai review cycle crashed");
  await pool.end();
  process.exit(1);
}
