import {
  ENRICHMENT_METHODS,
  ENRICHMENT_SOURCE_TYPES,
  ENRICHMENT_STATUSES,
  FACT_TYPES,
  NEWS_CATEGORIES,
  NEWS_TYPES,
  PERIOD_GRAINS,
  SALES_CHANNELS,
  SALES_METRICS,
  SENTIMENTS,
} from "@dip/domain";
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { brands } from "./brands.js";
import { enrichmentRuns } from "./enrichment.js";
import { factRuns } from "./facts.js";
import { inList } from "./helpers.js";
import { sources } from "./ingestion.js";
import { markets } from "./markets.js";
import { productsMaster } from "./products.js";

/**
 * Report-intelligence layer (Phase 8) — additive, backward-compatible. Adds the
 * report-ready commercial/media/brand tables the final product report needs,
 * without touching the core 8-table engine or any Phase 2–7 pipeline.
 *
 * - sales_facts / news_facts follow the Phase 6 append-only fact discipline:
 *   INSERT-only, UNIQUE dedup anchor (re-ingest = no-op), market_id nullable
 *   (null = unknown), source_id SET NULL + denormalized source_slug so
 *   provenance survives source-config deletion.
 * - brand_facts is the brand analog of product_enrichments: a review-gated
 *   provenance sidecar reusing the enrichment vocabularies + enrichment_runs.
 *
 * These tables have no pipeline writer yet — they are the stable contract a
 * future sales/news/brand-reference ingestion phase writes into.
 */

/** Append-only commercial signal: product × market × channel × metric × period. */
export const salesFacts = pgTable(
  "sales_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => productsMaster.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    sourceSlug: text("source_slug"),
    marketId: uuid("market_id").references(() => markets.id, { onDelete: "set null" }),
    channel: text("channel").notNull().default("unknown"),
    factType: text("fact_type").notNull().default("observed"),
    metric: text("metric").notNull(),
    metricValue: numeric("metric_value", { precision: 18, scale: 4 }).notNull(),
    /** ISO 4217, uppercased before insert — only for revenue-type metrics. */
    metricCurrency: text("metric_currency"),
    metricUnit: text("metric_unit"),
    periodGrain: text("period_grain").notNull().default("snapshot"),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
    sourceUrl: text("source_url").notNull(),
    evidence: text("evidence"),
    factRunId: uuid("fact_run_id").references(() => factRuns.id, { onDelete: "set null" }),
  },
  (table) => [
    check("sales_facts_channel_check", inList("channel", SALES_CHANNELS)),
    check("sales_facts_metric_check", inList("metric", SALES_METRICS)),
    check("sales_facts_period_grain_check", inList("period_grain", PERIOD_GRAINS)),
    check("sales_facts_fact_type_check", inList("fact_type", FACT_TYPES)),
    check("sales_facts_value_check", sql`${table.metricValue} >= 0`),
    check(
      "sales_facts_confidence_check",
      sql`${table.confidenceScore} >= 0 AND ${table.confidenceScore} <= 1`,
    ),
    // Re-ingesting the same signal for the same period is a structural no-op.
    uniqueIndex("sales_facts_dedup_unique").on(
      table.productId,
      table.sourceUrl,
      table.metric,
      table.channel,
      table.periodStart,
    ),
    index("sales_facts_product_period_idx").on(table.productId, table.periodStart),
    index("sales_facts_market_id_idx").on(table.marketId),
    index("sales_facts_source_id_idx").on(table.sourceId),
    index("sales_facts_metric_idx").on(table.metric),
  ],
);

/** Append-only media/news/event mention, attached to a product OR brand. */
export const newsFacts = pgTable(
  "news_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Product-level news dies with the product; brand-level news survives.
    productId: uuid("product_id").references(() => productsMaster.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    sourceSlug: text("source_slug"),
    marketId: uuid("market_id").references(() => markets.id, { onDelete: "set null" }),
    newsType: text("news_type").notNull().default("article"),
    category: text("category"),
    sentiment: text("sentiment"),
    sentimentScore: numeric("sentiment_score", { precision: 4, scale: 3 }),
    title: text("title"),
    summary: text("summary"),
    /** The article/media URL. */
    url: text("url").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
    /** Where we captured it (provenance), distinct from `url`. */
    sourceUrl: text("source_url").notNull(),
    evidence: text("evidence"),
    factRunId: uuid("fact_run_id").references(() => factRuns.id, { onDelete: "set null" }),
  },
  (table) => [
    check("news_facts_news_type_check", inList("news_type", NEWS_TYPES)),
    check("news_facts_category_check", inList("category", NEWS_CATEGORIES)),
    check("news_facts_sentiment_check", inList("sentiment", SENTIMENTS)),
    check(
      "news_facts_sentiment_score_check",
      sql`${table.sentimentScore} >= -1 AND ${table.sentimentScore} <= 1`,
    ),
    check(
      "news_facts_confidence_check",
      sql`${table.confidenceScore} >= 0 AND ${table.confidenceScore} <= 1`,
    ),
    // A news item must be about a product, a brand, or both.
    check("news_facts_subject_check", sql`${table.productId} IS NOT NULL OR ${table.brandId} IS NOT NULL`),
    uniqueIndex("news_facts_dedup_unique").on(table.url, table.productId, table.observedAt),
    index("news_facts_product_published_idx").on(table.productId, table.publishedAt),
    index("news_facts_brand_id_idx").on(table.brandId),
    index("news_facts_market_id_idx").on(table.marketId),
    index("news_facts_source_id_idx").on(table.sourceId),
    index("news_facts_news_type_idx").on(table.newsType),
    index("news_facts_sentiment_idx").on(table.sentiment),
  ],
);

/** Brand-attribute provenance sidecar — the brand analog of product_enrichments. */
export const brandFacts = pgTable(
  "brand_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    fieldName: text("field_name").notNull(),
    value: text("value"),
    valueJson: jsonb("value_json"),
    method: text("method").notNull(),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
    sourceUrl: text("source_url"),
    sourceType: text("source_type").notNull().default("brand_reference"),
    evidence: text("evidence"),
    status: text("status").notNull().default("proposed"),
    reason: text("reason"),
    enrichmentRunId: uuid("enrichment_run_id").references(() => enrichmentRuns.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("brand_facts_method_check", inList("method", ENRICHMENT_METHODS)),
    check("brand_facts_status_check", inList("status", ENRICHMENT_STATUSES)),
    check("brand_facts_source_type_check", inList("source_type", ENRICHMENT_SOURCE_TYPES)),
    check(
      "brand_facts_confidence_check",
      sql`${table.confidenceScore} >= 0 AND ${table.confidenceScore} <= 1`,
    ),
    // One record per (brand, field) — re-runs update, never duplicate.
    uniqueIndex("brand_facts_brand_field_unique").on(table.brandId, table.fieldName),
    index("brand_facts_status_idx").on(table.status),
    index("brand_facts_field_idx").on(table.fieldName),
  ],
);
