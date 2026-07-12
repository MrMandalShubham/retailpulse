import {
  BATCH_STATUSES,
  DISCOVERY_METHODS,
  DISCOVERY_RUN_STATUSES,
  DISCOVERY_STATUSES,
  DISCOVERY_STRATEGIES,
} from "@dip/domain";
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

/**
 * Product-discovery layer (Phase 0, slice 0a) — thin, additive, upstream of
 * ingestion. Maps which product pages exist on a source (sitemap-first,
 * deterministic) so they can be batched into the existing sources.seed_urls
 * flow. Does NOT extract/normalize/enrich/promote. Nothing here is written by
 * Phases 1+; Phases 1+ are untouched.
 *
 * The join key to canonical is normalized_url (via @dip/promotion
 * normalizeSourceUrl — the SAME normalizer product_sources uses), so a
 * discovered page can be linked to its canonical product after promotion.
 */

/** One discovery execution (audit + counters). */
export const discoveryRuns = pgTable(
  "discovery_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    strategy: text("strategy").notNull(),
    status: text("status").notNull().default("pending"),
    urlsDiscovered: integer("urls_discovered").notNull().default(0),
    newUrls: integer("new_urls").notNull().default(0),
    updatedUrls: integer("updated_urls").notNull().default(0),
    errors: integer("errors").notNull().default(0),
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
    check("discovery_runs_status_check", inList("status", DISCOVERY_RUN_STATUSES)),
    check("discovery_runs_strategy_check", inList("strategy", DISCOVERY_STRATEGIES)),
    index("discovery_runs_source_id_idx").on(table.sourceId),
    index("discovery_runs_created_at_idx").on(table.createdAt),
  ],
);

/** The mapping/queue row: one discovered product page per (source, url_hash). */
export const discoveredProductPages = pgTable(
  "discovered_product_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    sourceSlug: text("source_slug"),
    discoveredProductName: text("discovered_product_name"),
    productUrl: text("product_url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    urlHash: text("url_hash").notNull(),
    discoveryMethod: text("discovery_method").notNull(),
    pageTypeConfidence: numeric("page_type_confidence", { precision: 4, scale: 3 }),
    crawlDepth: integer("crawl_depth").notNull().default(0),
    parentListingUrl: text("parent_listing_url"),
    candidateMarketId: uuid("candidate_market_id").references(() => markets.id, {
      onDelete: "set null",
    }),
    // Axis 1: is it a real product page?
    discoveryStatus: text("discovery_status").notNull().default("candidate"),
    // Axis 2: ingestion lifecycle.
    batchStatus: text("batch_status").notNull().default("pending"),
    // Backfilled after promotion by matching normalized_url = product_sources.source_url.
    canonicalProductId: uuid("canonical_product_id").references(() => productsMaster.id, {
      onDelete: "set null",
    }),
    discoveryRunId: uuid("discovery_run_id").references(() => discoveryRuns.id, {
      onDelete: "set null",
    }),
    errorReason: text("error_reason"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("dpp_method_check", inList("discovery_method", DISCOVERY_METHODS)),
    check("dpp_discovery_status_check", inList("discovery_status", DISCOVERY_STATUSES)),
    check("dpp_batch_status_check", inList("batch_status", BATCH_STATUSES)),
    check(
      "dpp_confidence_check",
      sql`${table.pageTypeConfidence} >= 0 AND ${table.pageTypeConfidence} <= 1`,
    ),
    // Idempotency anchor: one row per (source, normalized URL). Re-discovery upserts.
    uniqueIndex("dpp_source_url_hash_unique").on(table.sourceId, table.urlHash),
    index("dpp_source_batch_idx").on(table.sourceId, table.batchStatus),
    index("dpp_discovery_status_idx").on(table.discoveryStatus),
    index("dpp_normalized_url_idx").on(table.normalizedUrl),
    index("dpp_canonical_product_id_idx").on(table.canonicalProductId),
  ],
);
