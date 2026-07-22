import { CRAWL_JOB_STATUSES, RAW_DOCUMENT_STATUSES, SOURCE_TYPES } from "@dip/domain";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { inList } from "./helpers.js";

/**
 * Raw ELT layer: sources -> crawl_jobs -> raw_documents.
 *
 * ON DELETE design: deletion cascades downward (sources -> crawl_jobs ->
 * raw_documents) — removing a source config intentionally discards its
 * ingestion history.
 */

/** External websites / APIs we ingest from. */
export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    baseUrl: text("base_url").notNull(),
    sourceType: text("source_type").notNull().default("website"),
    enabled: boolean("enabled").notNull().default(true),
    // URLs fetched per crawl in Phase 2. The max-5-per-job cap is an
    // application rule (MAX_SEED_URLS_PER_JOB), deliberately not a constraint.
    seedUrls: text("seed_urls")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    scrapeStrategy: text("scrape_strategy"),
    // Phase 0 (discovery) per-source config: { strategy, sitemapUrl,
    // productUrlRegex, maxUrls }. Additive; unused by Phases 1+.
    discoveryConfig: jsonb("discovery_config"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  () => [check("sources_source_type_check", inList("source_type", SOURCE_TYPES))],
);

/** One ingestion run for a source. */
export const crawlJobs = pgTable(
  "crawl_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    attemptNumber: integer("attempt_number").notNull().default(1),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("crawl_jobs_status_check", inList("status", CRAWL_JOB_STATUSES)),
    index("crawl_jobs_source_id_idx").on(table.sourceId),
    index("crawl_jobs_status_idx").on(table.status),
    index("crawl_jobs_created_at_idx").on(table.createdAt),
  ],
);

/** One fetched URL within a crawl job (payload lives in object storage). */
export const rawDocuments = pgTable(
  "raw_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crawlJobId: uuid("crawl_job_id")
      .notNull()
      .references(() => crawlJobs.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    contentType: text("content_type"),
    storageKey: text("storage_key"),
    checksum: text("checksum"),
    status: text("status").notNull(),
    httpStatus: integer("http_status"),
    responseBytes: integer("response_bytes"),
    errorMessage: text("error_message"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("raw_documents_status_check", inList("status", RAW_DOCUMENT_STATUSES)),
    index("raw_documents_crawl_job_id_idx").on(table.crawlJobId),
    index("raw_documents_source_id_fetched_at_idx").on(table.sourceId, table.fetchedAt),
    index("raw_documents_url_idx").on(table.url),
  ],
);
