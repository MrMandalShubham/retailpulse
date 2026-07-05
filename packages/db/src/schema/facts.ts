import { FACT_RUN_STATUSES, FACT_TYPES, SOURCE_MARKET_CONFIDENCES } from "@dip/domain";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { inList } from "./helpers.js";
import { sources } from "./ingestion.js";
import { markets } from "./markets.js";
import { productsMaster } from "./products.js";
import { stagedProducts } from "./transform.js";

/**
 * Fact + market-mapping layer (Phase 6).
 *
 * Rules encoded here:
 * - Facts are APPEND-ONLY history: pipelines only INSERT (with conflict-skip
 *   dedup); nothing updates or deletes fact rows.
 * - market_id is NULLABLE on facts: null = honestly unknown. Mappings live
 *   only in source_markets and are created by seed/operator, never inferred.
 * - Dedup anchor (approved): UNIQUE (product_id, source_url, observed_at)
 *   where observed_at = raw_documents.fetched_at and source_url is the
 *   NORMALIZED form — re-processing the same evidence is a structural no-op.
 * - fact_type: 'observed' = direct source evidence (all Phase 6 writes);
 *   'derived' reserved for future computed facts.
 */

/** Source→market mapping. One source may map to several markets. */
export const sourceMarkets = pgTable(
  "source_markets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id, { onDelete: "cascade" }),
    confidence: text("confidence").notNull().default("inferred"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("source_markets_confidence_check", inList("confidence", SOURCE_MARKET_CONFIDENCES)),
    uniqueIndex("source_markets_source_market_unique").on(table.sourceId, table.marketId),
    index("source_markets_market_id_idx").on(table.marketId),
  ],
);

/** One fact-extraction execution (audit + counters). */
export const factRuns = pgTable(
  "fact_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: text("status").notNull().default("pending"),
    productsConsidered: integer("products_considered").notNull().default(0),
    priceFactsInserted: integer("price_facts_inserted").notNull().default(0),
    ratingFactsInserted: integer("rating_facts_inserted").notNull().default(0),
    duplicatesSkipped: integer("duplicates_skipped").notNull().default(0),
    skippedInvalid: integer("skipped_invalid").notNull().default(0),
    coreRollupsInserted: integer("core_rollups_inserted").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("fact_runs_status_check", inList("status", FACT_RUN_STATUSES)),
    index("fact_runs_created_at_idx").on(table.createdAt),
  ],
);

/** Append-only price observations. */
export const productPriceFacts = pgTable(
  "product_price_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => productsMaster.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    sourceSlug: text("source_slug"),
    stagedProductId: uuid("staged_product_id").references(() => stagedProducts.id, {
      onDelete: "set null",
    }),
    marketId: uuid("market_id").references(() => markets.id, { onDelete: "set null" }),
    factType: text("fact_type").default("observed"),
    priceValue: numeric("price_value", { precision: 12, scale: 2 }).notNull(),
    /** Always uppercased before insert (approved rule). */
    priceCurrency: text("price_currency").notNull(),
    priceOriginalText: text("price_original_text"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
    sourceUrl: text("source_url").notNull(),
    factRunId: uuid("fact_run_id").references(() => factRuns.id, { onDelete: "set null" }),
  },
  (table) => [
    check("product_price_facts_fact_type_check", inList("fact_type", FACT_TYPES)),
    check("product_price_facts_price_check", sql`${table.priceValue} > 0`),
    check(
      "product_price_facts_confidence_check",
      sql`${table.confidenceScore} >= 0 AND ${table.confidenceScore} <= 1`,
    ),
    uniqueIndex("product_price_facts_dedup_unique").on(
      table.productId,
      table.sourceUrl,
      table.observedAt,
    ),
    index("product_price_facts_product_observed_idx").on(table.productId, table.observedAt),
    index("product_price_facts_source_id_idx").on(table.sourceId),
    index("product_price_facts_market_id_idx").on(table.marketId),
  ],
);

/** Append-only rating/review observations. */
export const productRatingFacts = pgTable(
  "product_rating_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => productsMaster.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    sourceSlug: text("source_slug"),
    stagedProductId: uuid("staged_product_id").references(() => stagedProducts.id, {
      onDelete: "set null",
    }),
    marketId: uuid("market_id").references(() => markets.id, { onDelete: "set null" }),
    factType: text("fact_type").default("observed"),
    ratingValue: numeric("rating_value", { precision: 3, scale: 2 }).notNull(),
    ratingScale: text("rating_scale").notNull().default("0-5"),
    reviewCount: integer("review_count"),
    ratingOriginalText: text("rating_original_text"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
    sourceUrl: text("source_url").notNull(),
    factRunId: uuid("fact_run_id").references(() => factRuns.id, { onDelete: "set null" }),
  },
  (table) => [
    check("product_rating_facts_fact_type_check", inList("fact_type", FACT_TYPES)),
    check(
      "product_rating_facts_rating_check",
      sql`${table.ratingValue} >= 0 AND ${table.ratingValue} <= 5`,
    ),
    check("product_rating_facts_review_count_check", sql`${table.reviewCount} >= 0`),
    check(
      "product_rating_facts_confidence_check",
      sql`${table.confidenceScore} >= 0 AND ${table.confidenceScore} <= 1`,
    ),
    uniqueIndex("product_rating_facts_dedup_unique").on(
      table.productId,
      table.sourceUrl,
      table.observedAt,
    ),
    index("product_rating_facts_product_observed_idx").on(table.productId, table.observedAt),
    index("product_rating_facts_source_id_idx").on(table.sourceId),
    index("product_rating_facts_market_id_idx").on(table.marketId),
  ],
);
