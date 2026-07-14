import { BATCH_STATUSES, DISCOVERY_RUN_STATUSES, DISCOVERY_STRATEGIES } from "@dip/domain";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { inList } from "./helpers.js";
import { sources } from "./ingestion.js";

/**
 * Product-discovery layer (Phase 0) — thin, additive, upstream of ingestion.
 * Maps which product pages exist on a source so they can be batched into the
 * existing sources.seed_urls flow. Does NOT extract/normalize/enrich/promote.
 * Nothing here is written by Phases 1+; Phases 1+ are untouched.
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

/**
 * The lean map/queue row (8 columns). One row per (source, native product id).
 *  - product_id: the source's own product number — stable identity + dedup key.
 *  - product_url: the page ingestion visits to scrape.
 *  - normalized_url: canonical form; dedup + join to product_sources.source_url.
 *  - batch_status: the ingestion lifecycle.
 */
export const discoveredProductPages = pgTable(
  "discovered_product_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    productName: text("product_name"),
    productUrl: text("product_url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    batchStatus: text("batch_status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("dpp_batch_status_check", inList("batch_status", BATCH_STATUSES)),
    // Identity + idempotency anchor: one row per (source, native product id).
    uniqueIndex("dpp_source_product_unique").on(table.sourceId, table.productId),
    // Hot path: "give me the next N pending pages for this source".
    index("dpp_source_batch_idx").on(table.sourceId, table.batchStatus),
    // Canonical backfill join: normalized_url == product_sources.source_url.
    index("dpp_normalized_url_idx").on(table.normalizedUrl),
  ],
);
