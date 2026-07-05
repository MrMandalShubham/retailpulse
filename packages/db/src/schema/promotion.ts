import {
  MATCH_STRATEGIES,
  PRODUCT_MEDIA_TYPES,
  PROMOTION_DECISIONS,
  PROMOTION_RUN_STATUSES,
  PROMOTION_TRIGGER_TYPES,
} from "@dip/domain";
import { sql } from "drizzle-orm";
import {
  check,
  customType,
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
import { productsMaster } from "./products.js";
import { stagedProducts } from "./transform.js";

/**
 * Canonical promotion layer (Phase 5). @dip/promotion is the ONLY writer of
 * canonical product truth; every write is traceable through promotion_runs /
 * promotion_items. Provenance (product_sources), media references
 * (product_media) and the search projection (product_search_documents) are
 * canonical-adjacent helper tables — additive, no change to the 8-table core.
 *
 * product_sources.source_url is stored in NORMALIZED form (lowercased host,
 * tracking params stripped, params sorted, no fragment/trailing slash) and is
 * UNIQUE: the same page can never spawn two canonical products.
 */

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/** One promotion batch or single-item trigger. */
export const promotionRuns = pgTable(
  "promotion_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: text("status").notNull().default("pending"),
    triggerType: text("trigger_type").notNull().default("batch"),
    totalItems: integer("total_items").notNull().default(0),
    promotedNew: integer("promoted_new").notNull().default(0),
    matchedExisting: integer("matched_existing").notNull().default(0),
    skippedItems: integer("skipped_items").notNull().default(0),
    failedItems: integer("failed_items").notNull().default(0),
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
    check("promotion_runs_status_check", inList("status", PROMOTION_RUN_STATUSES)),
    check("promotion_runs_trigger_type_check", inList("trigger_type", PROMOTION_TRIGGER_TYPES)),
    index("promotion_runs_status_idx").on(table.status),
    index("promotion_runs_created_at_idx").on(table.createdAt),
  ],
);

/** Audit trail: one row per staged product considered by a promotion run. */
export const promotionItems = pgTable(
  "promotion_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promotionRunId: uuid("promotion_run_id")
      .notNull()
      .references(() => promotionRuns.id, { onDelete: "cascade" }),
    // Audit outlives regenerable staging — SET NULL, never CASCADE.
    stagedProductId: uuid("staged_product_id").references(() => stagedProducts.id, {
      onDelete: "set null",
    }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => productsMaster.id, { onDelete: "set null" }),
    decision: text("decision").notNull(),
    eligibilityReasons: text("eligibility_reasons")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    matchStrategy: text("match_strategy"),
    matchScore: numeric("match_score", { precision: 4, scale: 3 }),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
    operatorNote: text("operator_note"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("promotion_items_decision_check", inList("decision", PROMOTION_DECISIONS)),
    check("promotion_items_match_strategy_check", inList("match_strategy", MATCH_STRATEGIES)),
    check(
      "promotion_items_match_score_check",
      sql`${table.matchScore} >= 0 AND ${table.matchScore} <= 1`,
    ),
    index("promotion_items_run_id_idx").on(table.promotionRunId),
    index("promotion_items_decision_idx").on(table.decision),
    index("promotion_items_product_id_idx").on(table.productId),
    index("promotion_items_staged_product_id_idx").on(table.stagedProductId),
  ],
);

/** Provenance: which source pages back a canonical product. */
export const productSources = pgTable(
  "product_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => productsMaster.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    // Denormalized so provenance survives source-config deletion.
    sourceSlug: text("source_slug"),
    stagedProductId: uuid("staged_product_id").references(() => stagedProducts.id, {
      onDelete: "set null",
    }),
    /** NORMALIZED url — the canonical idempotency anchor. */
    sourceUrl: text("source_url").notNull().unique(),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastPromotedAt: timestamp("last_promoted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("product_sources_product_id_idx").on(table.productId)],
);

/** Media references only — payloads stay in object storage / at origin. */
export const productMedia = pgTable(
  "product_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => productsMaster.id, { onDelete: "cascade" }),
    mediaType: text("media_type").notNull().default("image"),
    url: text("url").notNull(),
    storageKey: text("storage_key"),
    position: integer("position").notNull().default(0),
    sourceUrl: text("source_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("product_media_media_type_check", inList("media_type", PRODUCT_MEDIA_TYPES)),
    uniqueIndex("product_media_product_id_url_unique").on(table.productId, table.url),
  ],
);

/** Search/filter projection, rewritten in the same transaction as any canonical write. */
export const productSearchDocuments = pgTable(
  "product_search_documents",
  {
    productId: uuid("product_id")
      .primaryKey()
      .references(() => productsMaster.id, { onDelete: "cascade" }),
    searchText: text("search_text").notNull(),
    searchVector: tsvector("search_vector"),
    brandName: text("brand_name"),
    categoryName: text("category_name"),
    productTypeName: text("product_type_name"),
    priceValue: numeric("price_value", { precision: 12, scale: 2 }),
    priceCurrency: text("price_currency"),
    rating: numeric("rating", { precision: 3, scale: 2 }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("product_search_documents_vector_idx").using("gin", table.searchVector),
    index("product_search_documents_brand_idx").on(table.brandName),
    index("product_search_documents_price_idx").on(table.priceValue),
    index("product_search_documents_rating_idx").on(table.rating),
  ],
);
