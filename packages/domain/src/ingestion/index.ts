/**
 * Ingestion domain — the ingestion-control layer: sources and crawl jobs.
 * Phase 1 fetches each product's API envelope in memory and writes it straight
 * to the clean per-platform store; crawl_jobs is the fetch-run log. No raw
 * documents are persisted (the raw layer was dropped).
 */

export const SOURCE_TYPES = ["website", "marketplace", "api", "review_platform"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const CRAWL_JOB_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export type CrawlJobStatus = (typeof CRAWL_JOB_STATUSES)[number];

/**
 * Max seed URLs fetched per source per crawl job. Application-level rule
 * (approved decision) — deliberately NOT a DB constraint.
 */
export const MAX_SEED_URLS_PER_JOB = 5;

/** External website / API we ingest from (sources). */
export interface Source {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
  sourceType: SourceType;
  enabled: boolean;
  /** URLs fetched per discovery crawl; capped by MAX_SEED_URLS_PER_JOB. */
  seedUrls: string[];
  scrapeStrategy: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One ingestion run for a source (crawl_jobs). */
export interface CrawlJob {
  id: string;
  sourceId: string;
  status: CrawlJobStatus;
  attemptNumber: number;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
