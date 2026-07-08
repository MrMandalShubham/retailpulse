import {
  ENRICHMENT_METHODS,
  ENRICHMENT_RUN_STATUSES,
  ENRICHMENT_SOURCE_TYPES,
  ENRICHMENT_STATUSES,
} from "@dip/domain";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { inList } from "./helpers.js";
import { productsMaster } from "./products.js";

/**
 * Enrichment provenance layer (Phase 7). Additive sidecar — the ONLY new
 * writers of the Phase 7 products_master columns, always fill-if-null.
 * product_enrichments records raw source + derived value + confidence +
 * timestamp + source type for every attempt, so any filled value is traceable
 * and any null carries a reason. Nothing here changes Phase 1–6 logic.
 */

export const enrichmentRuns = pgTable(
  "enrichment_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: text("status").notNull().default("pending"),
    productsConsidered: integer("products_considered").notNull().default(0),
    deterministicApplied: integer("deterministic_applied").notNull().default(0),
    aiProposed: integer("ai_proposed").notNull().default(0),
    needsSource: integer("needs_source").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
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
    check("enrichment_runs_status_check", inList("status", ENRICHMENT_RUN_STATUSES)),
    index("enrichment_runs_created_at_idx").on(table.createdAt),
  ],
);

export const productEnrichments = pgTable(
  "product_enrichments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => productsMaster.id, { onDelete: "cascade" }),
    fieldName: text("field_name").notNull(),
    value: text("value"),
    valueJson: jsonb("value_json"),
    method: text("method").notNull(),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
    sourceUrl: text("source_url"),
    sourceType: text("source_type").notNull().default("derived"),
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
    check("product_enrichments_method_check", inList("method", ENRICHMENT_METHODS)),
    check("product_enrichments_status_check", inList("status", ENRICHMENT_STATUSES)),
    check("product_enrichments_source_type_check", inList("source_type", ENRICHMENT_SOURCE_TYPES)),
    check(
      "product_enrichments_confidence_check",
      sql`${table.confidenceScore} >= 0 AND ${table.confidenceScore} <= 1`,
    ),
    // One enrichment record per (product, field) — re-runs update, never duplicate.
    uniqueIndex("product_enrichments_product_field_unique").on(table.productId, table.fieldName),
    index("product_enrichments_status_idx").on(table.status),
    index("product_enrichments_field_idx").on(table.fieldName),
  ],
);
