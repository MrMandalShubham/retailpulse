import {
  AI_REVIEW_ITEM_STATUSES,
  AI_REVIEW_ITEM_TYPES,
  AI_REVIEW_RUN_STATUSES,
  AI_RULE_SUGGESTION_STATUSES,
  RULE_TYPES,
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
import { sources } from "./ingestion.js";
import { stagedProducts, transformObservations, transformRuns } from "./transform.js";

/**
 * AI review layer (Phase 4): audit-grade records of selective AI escalation.
 * AI output is advisory — it lands here and in ai_rule_suggestions, never
 * directly in normalization_rules (approval path only) and NEVER in the
 * canonical 8-table core.
 *
 * FK design: run/item rows are audit history, so references to regenerable
 * staging rows are SET NULL (not CASCADE). Because staged_product_id /
 * observation_id can be nulled later by reprocessing, the "item_type matches
 * populated FK" rule is enforced at the application layer, not by a CHECK —
 * a CHECK would block staging regeneration.
 */

/** One AI review batch/run. */
export const aiReviewRuns = pgTable(
  "ai_review_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    transformRunId: uuid("transform_run_id").references(() => transformRuns.id, {
      onDelete: "set null",
    }),
    providerName: text("provider_name").notNull(),
    modelName: text("model_name").notNull(),
    status: text("status").notNull().default("pending"),
    totalItems: integer("total_items").notNull().default(0),
    processedItems: integer("processed_items").notNull().default(0),
    succeededItems: integer("succeeded_items").notNull().default(0),
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
    check("ai_review_runs_status_check", inList("status", AI_REVIEW_RUN_STATUSES)),
    index("ai_review_runs_status_idx").on(table.status),
    index("ai_review_runs_created_at_idx").on(table.createdAt),
  ],
);

/** One staged_product or observation sent for AI review. */
export const aiReviewItems = pgTable(
  "ai_review_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aiReviewRunId: uuid("ai_review_run_id")
      .notNull()
      .references(() => aiReviewRuns.id, { onDelete: "cascade" }),
    stagedProductId: uuid("staged_product_id").references(() => stagedProducts.id, {
      onDelete: "set null",
    }),
    observationId: uuid("observation_id").references(() => transformObservations.id, {
      onDelete: "set null",
    }),
    itemType: text("item_type").notNull(),
    /** Why this item was escalated to AI (eligibility trail). */
    reviewReason: text("review_reason"),
    providerName: text("provider_name").notNull(),
    modelName: text("model_name").notNull(),
    inputPayload: jsonb("input_payload").notNull(),
    outputPayload: jsonb("output_payload"),
    parsedDecision: jsonb("parsed_decision"),
    status: text("status").notNull().default("pending"),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("ai_review_items_item_type_check", inList("item_type", AI_REVIEW_ITEM_TYPES)),
    check("ai_review_items_status_check", inList("status", AI_REVIEW_ITEM_STATUSES)),
    check(
      "ai_review_items_confidence_check",
      sql`${table.confidenceScore} >= 0 AND ${table.confidenceScore} <= 1`,
    ),
    index("ai_review_items_run_id_idx").on(table.aiReviewRunId),
    index("ai_review_items_status_idx").on(table.status),
    index("ai_review_items_staged_product_id_idx").on(table.stagedProductId),
    index("ai_review_items_observation_id_idx").on(table.observationId),
  ],
);

/** AI-proposed rules awaiting the controlled approval path. */
export const aiRuleSuggestions = pgTable(
  "ai_rule_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aiReviewItemId: uuid("ai_review_item_id")
      .notNull()
      .references(() => aiReviewItems.id, { onDelete: "cascade" }),
    observationId: uuid("observation_id").references(() => transformObservations.id, {
      onDelete: "set null",
    }),
    ruleType: text("rule_type").notNull(),
    sourceScope: text("source_scope").notNull().default("global"),
    matchKey: text("match_key").notNull(),
    matchValue: text("match_value"),
    normalizedKey: text("normalized_key"),
    normalizedValue: text("normalized_value"),
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
    check("ai_rule_suggestions_rule_type_check", inList("rule_type", RULE_TYPES)),
    check("ai_rule_suggestions_status_check", inList("status", AI_RULE_SUGGESTION_STATUSES)),
    check(
      "ai_rule_suggestions_confidence_check",
      sql`${table.confidenceScore} >= 0 AND ${table.confidenceScore} <= 1`,
    ),
    // Duplication guard (approved decision): the same still-open suggestion for
    // the same observation/rule fingerprint cannot pile up across repeated runs.
    // The pipeline inserts with ON CONFLICT DO NOTHING against this index.
    uniqueIndex("ai_rule_suggestions_open_fingerprint_unique")
      .on(table.observationId, table.ruleType, table.sourceScope, table.matchKey)
      .where(sql`status = 'open'`),
    index("ai_rule_suggestions_status_idx").on(table.status),
    index("ai_rule_suggestions_rule_type_idx").on(table.ruleType),
  ],
);
