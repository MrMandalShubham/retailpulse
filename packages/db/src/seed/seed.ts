/**
 * Idempotent seed: approved ingestion source (Phase 2) + conservative starter
 * normalization rules (Phase 3). Safe to re-run — sources upsert by slug,
 * rules insert-if-absent on (rule_type, source_scope, match_key).
 * Run via `pnpm db:seed` (after `pnpm build`).
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
import { loadConfig } from "@dip/config";
import { createDb } from "../client.js";
import { sourceMarkets } from "../schema/facts.js";
import { sources } from "../schema/ingestion.js";
import { markets } from "../schema/markets.js";
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

// ---------------------------------------------------------------------------
// Phase 6 market mapping (approved).
// IMPORTANT: 'XG' is an INTERNAL, user-assigned cross-border market code from
// the ISO 3166 user-assigned range. It is NOT a real ISO country code and must
// never be presented as a country. It exists because Olive Young Global
// genuinely operates ONE global cross-border storefront (USD pricing,
// worldwide shipping). Real country markets get real ISO codes when mapped.
// ---------------------------------------------------------------------------
await db
  .insert(markets)
  .values({
    name: "Global (Cross-border)",
    code: "XG",
    region: "Global",
    regulatoryAuthority: null,
  })
  .onConflictDoNothing({ target: markets.code });

const [xgMarket] = await db.select({ id: markets.id }).from(markets).where(eq(markets.code, "XG"));
const [oliveYoung] = await db
  .select({ id: sources.id })
  .from(sources)
  .where(eq(sources.slug, OLIVE_YOUNG_GLOBAL.slug));
if (xgMarket && oliveYoung) {
  await db
    .insert(sourceMarkets)
    .values({
      sourceId: oliveYoung.id,
      marketId: xgMarket.id,
      confidence: "confirmed",
      notes:
        "Olive Young Global is a single global cross-border storefront (USD pricing, worldwide shipping). XG is an internal user-assigned code, not a country.",
    })
    .onConflictDoNothing({ target: [sourceMarkets.sourceId, sourceMarkets.marketId] });
  console.log("seeded market 'Global (Cross-border)' (XG) + oliveyoung-global mapping");
}

// ---------------------------------------------------------------------------
// Phase 7: real ISO country markets (reference structure). These are seeded as
// master data but left UNMAPPED (no source_markets) — a country market only
// receives facts once a country-specific source is mapped to it by an operator.
// Real ISO 3166-1 alpha-2 codes (unlike the internal XG cross-border code).
// ---------------------------------------------------------------------------
const COUNTRY_MARKETS = [
  { name: "South Korea", code: "KR", region: "Asia", regulatoryAuthority: "MFDS" },
  { name: "United States", code: "US", region: "North America", regulatoryAuthority: "FDA" },
  { name: "Japan", code: "JP", region: "Asia", regulatoryAuthority: "MHLW" },
  { name: "United Kingdom", code: "GB", region: "Europe", regulatoryAuthority: "OPSS" },
];
const seededMarkets = await db
  .insert(markets)
  .values(COUNTRY_MARKETS)
  .onConflictDoNothing({ target: markets.code })
  .returning({ code: markets.code });
console.log(
  `seeded ${seededMarkets.length} new country markets (KR/US/JP/GB reference structure; unmapped until a country source is added)`,
);

await pool.end();
