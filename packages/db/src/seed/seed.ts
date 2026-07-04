/**
 * Idempotent seed: approved ingestion source (Phase 2) + conservative starter
 * normalization rules (Phase 3). Safe to re-run — sources upsert by slug,
 * rules insert-if-absent on (rule_type, source_scope, match_key).
 * Run via `pnpm db:seed` (after `pnpm build`).
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { loadConfig } from "@dip/config";
import { createDb } from "../client.js";
import { sources } from "../schema/ingestion.js";
import { normalizationRules } from "../schema/transform.js";

loadEnv({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);

// ---------------------------------------------------------------------------
// Approved Phase 2 source. Seed URLs contain ONLY the approved homepage;
// approved category/product URLs are added later via UPDATE when provided.
// ---------------------------------------------------------------------------
const OLIVE_YOUNG_GLOBAL = {
  name: "Olive Young Global",
  slug: "oliveyoung-global",
  baseUrl: "https://global.oliveyoung.com/",
  sourceType: "marketplace",
  enabled: true,
  seedUrls: ["https://global.oliveyoung.com/"],
  scrapeStrategy: "Static HTML fetch of seed URLs (Phase 2). Dynamic rendering evaluated later.",
  notes: "Approved Phase 2 source; max 5 seed URLs fetched per job (application rule).",
};

await db
  .insert(sources)
  .values(OLIVE_YOUNG_GLOBAL)
  .onConflictDoUpdate({
    target: sources.slug,
    set: {
      name: OLIVE_YOUNG_GLOBAL.name,
      baseUrl: OLIVE_YOUNG_GLOBAL.baseUrl,
      sourceType: OLIVE_YOUNG_GLOBAL.sourceType,
      enabled: OLIVE_YOUNG_GLOBAL.enabled,
      seedUrls: OLIVE_YOUNG_GLOBAL.seedUrls,
      scrapeStrategy: OLIVE_YOUNG_GLOBAL.scrapeStrategy,
      notes: OLIVE_YOUNG_GLOBAL.notes,
      updatedAt: new Date(),
    },
  });
console.log(`seeded source '${OLIVE_YOUNG_GLOBAL.slug}'`);

// ---------------------------------------------------------------------------
// Conservative starter rules (approved): safe currency hints, obvious ignore
// patterns, small set of confirmed brand aliases. Deliberately NO speculative
// category/product-type mappings — those are learned via observations later.
// match_key for brand aliases is stored FOLDED (lowercase, alphanumeric+space)
// to match the worker's fold() lookups.
// ---------------------------------------------------------------------------
const STARTER_RULES = [
  // Currency hints (symbol -> ISO 4217). '¥' intentionally omitted: JPY/CNY ambiguity.
  ...[
    ["₩", "KRW"],
    ["$", "USD"],
    ["US$", "USD"],
    ["€", "EUR"],
    ["£", "GBP"],
  ].map(([symbol, code]) => ({
    ruleType: "currency_hint",
    sourceScope: "global",
    matchKey: symbol as string,
    normalizedValue: code as string,
    notes: "starter seed",
  })),

  // Ignore patterns (URL substrings that are never product evidence).
  ...["/login", "/cart", "/member/", "/terms", "/privacy"].map((pattern) => ({
    ruleType: "ignore_pattern",
    sourceScope: "global",
    matchKey: pattern,
    notes: "starter seed",
  })),

  // Confirmed brand aliases (folded alias -> canonical brand name).
  ...[
    ["dr jart", "Dr. Jart+"],
    ["drjart", "Dr. Jart+"],
    ["laneige", "LANEIGE"],
    ["cosrx", "COSRX"],
    ["sulwhasoo", "Sulwhasoo"],
  ].map(([alias, canonical]) => ({
    ruleType: "brand_alias",
    sourceScope: "global",
    matchKey: alias as string,
    normalizedValue: canonical as string,
    notes: "starter seed (confirmed)",
  })),
];

const inserted = await db
  .insert(normalizationRules)
  .values(STARTER_RULES)
  .onConflictDoNothing({
    target: [
      normalizationRules.ruleType,
      normalizationRules.sourceScope,
      normalizationRules.matchKey,
    ],
  })
  .returning({ id: normalizationRules.id });
console.log(`seeded ${inserted.length} new normalization rules (${STARTER_RULES.length} defined)`);

await pool.end();
