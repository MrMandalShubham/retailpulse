import {
  OBSERVATION_STATUSES,
  OBSERVATION_TYPES,
  PAGE_TYPES,
  EXTRACTION_METHODS,
  RULE_TYPES,
  TRANSFORM_RUN_STATUSES,
  VALIDATION_STATUSES,
} from "@dip/domain";
import { sql } from "drizzle-orm";
import {
  boolean,
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
import { crawlJobs, rawDocuments, sources } from "./ingestion.js";

/**
 * Staging / hybrid transform layer (Phase 3). Strictly separate from the
 * canonical 8-table core: nothing here references or writes to it. Staged rows
 * and observations are REGENERABLE from raw evidence — hence CASCADE from
 * their raw-layer parents. normalization_rules is standalone system
 * intelligence: local rules today, AI-learned rules (learned_from_ai) later.
 */

/** One transform execution. */
export const transformRuns = pgTable(
  "transform_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crawlJobId: uuid("crawl_job_id").references(() => crawlJobs.id, { onDelete: "set null" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    totalDocuments: integer("total_documents").notNull().default(0),
    processedDocuments: integer("processed_documents").notNull().default(0),
    succeededDocuments: integer("succeeded_documents").notNull().default(0),
    failedDocuments: integer("failed_documents").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("transform_runs_status_check", inList("status", TRANSFORM_RUN_STATUSES)),
    index("transform_runs_status_idx").on(table.status),
    index("transform_runs_created_at_idx").on(table.createdAt),
    index("transform_runs_source_id_idx").on(table.sourceId),
  ],
);

/** One product candidate extracted from a raw document. */
export const stagedProducts = pgTable(
  "staged_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transformRunId: uuid("transform_run_id")
      .notNull()
      .references(() => transformRuns.id, { onDelete: "cascade" }),
    rawDocumentId: uuid("raw_document_id")
      .notNull()
      .references(() => rawDocuments.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url"),
    pageType: text("page_type"),
    dominantSignal: text("dominant_signal"),
    extractedName: text("extracted_name"),
    extractedBrand: text("extracted_brand"),
    extractedCategory: text("extracted_category"),
    extractedProductType: text("extracted_product_type"),
    extractedDescription: text("extracted_description"),
    extractedCurrency: text("extracted_currency"),
    extractedPriceText: text("extracted_price_text"),
    extractedRatingText: text("extracted_rating_text"),
    primaryImageUrl: text("primary_image_url"),
    extractionMethod: text("extraction_method"),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
    validationStatus: text("validation_status").notNull().default("pending"),
    validationErrors: text("validation_errors")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    normalizedPayload: jsonb("normalized_payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    fieldCandidates: jsonb("field_candidates")
      .notNull()
      .default(sql`'{}'::jsonb`),
    fieldConfidences: jsonb("field_confidences")
      .notNull()
      .default(sql`'{}'::jsonb`),
    unresolvedFields: text("unresolved_fields")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    aiRecommended: boolean("ai_recommended").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("staged_products_page_type_check", inList("page_type", PAGE_TYPES)),
    check(
      "staged_products_extraction_method_check",
      inList("extraction_method", EXTRACTION_METHODS),
    ),
    check(
      "staged_products_validation_status_check",
      inList("validation_status", VALIDATION_STATUSES),
    ),
    check(
      "staged_products_confidence_score_check",
      sql`${table.confidenceScore} >= 0 AND ${table.confidenceScore} <= 1`,
    ),
    index("staged_products_transform_run_id_idx").on(table.transformRunId),
    index("staged_products_raw_document_id_idx").on(table.rawDocumentId),
    index("staged_products_source_id_idx").on(table.sourceId),
    index("staged_products_validation_status_idx").on(table.validationStatus),
    index("staged_products_ai_recommended_idx").on(table.aiRecommended),
  ],
);

/** Reusable normalization logic and learned mappings. */
export const normalizationRules = pgTable(
  "normalization_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleType: text("rule_type").notNull(),
    // Source slug or 'global'. NOT NULL so the uniqueness below is enforceable.
    sourceScope: text("source_scope").notNull().default("global"),
    matchKey: text("match_key").notNull(),
    matchValue: text("match_value"),
    normalizedKey: text("normalized_key"),
    normalizedValue: text("normalized_value"),
    priority: integer("priority").notNull().default(100),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    learnedFromAi: boolean("learned_from_ai").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("normalization_rules_rule_type_check", inList("rule_type", RULE_TYPES)),
    uniqueIndex("normalization_rules_type_scope_key_unique").on(
      table.ruleType,
      table.sourceScope,
      table.matchKey,
    ),
    index("normalization_rules_rule_type_active_idx").on(table.ruleType, table.active),
  ],
);

/** Unresolved or interesting leftovers queued for future AI review. */
export const transformObservations = pgTable(
  "transform_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transformRunId: uuid("transform_run_id")
      .notNull()
      .references(() => transformRuns.id, { onDelete: "cascade" }),
    // SET NULL: an observation is a work item that outlives regenerated staging.
    stagedProductId: uuid("staged_product_id").references(() => stagedProducts.id, {
      onDelete: "set null",
    }),
    rawDocumentId: uuid("raw_document_id")
      .notNull()
      .references(() => rawDocuments.id, { onDelete: "cascade" }),
    observationType: text("observation_type").notNull(),
    fieldName: text("field_name"),
    rawValue: text("raw_value"),
    suggestedValue: text("suggested_value"),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
    status: text("status").notNull().default("open"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "transform_observations_type_check",
      inList("observation_type", OBSERVATION_TYPES),
    ),
    check("transform_observations_status_check", inList("status", OBSERVATION_STATUSES)),
    check(
      "transform_observations_confidence_check",
      sql`${table.confidenceScore} >= 0 AND ${table.confidenceScore} <= 1`,
    ),
    index("transform_observations_status_idx").on(table.status),
    index("transform_observations_type_idx").on(table.observationType),
    index("transform_observations_run_id_idx").on(table.transformRunId),
    index("transform_observations_raw_document_id_idx").on(table.rawDocumentId),
  ],
);
