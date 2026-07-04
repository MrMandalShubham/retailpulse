/**
 * Ingestion domain — the raw ELT collection layer: sources, crawl jobs, and
 * raw documents. Phase 2 implements "fetch → store raw → record metadata";
 * scheduling/queueing (Redis) and browser rendering arrive in later phases.
 */

export const SOURCE_TYPES = ["website", "marketplace", "api", "review_platform"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const CRAWL_JOB_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export type CrawlJobStatus = (typeof CRAWL_JOB_STATUSES)[number];

export const RAW_DOCUMENT_STATUSES = ["ok", "error", "skipped"] as const;
export type RawDocumentStatus = (typeof RAW_DOCUMENT_STATUSES)[number];

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
  marketId: string | null;
  enabled: boolean;
  /** URLs fetched per crawl in Phase 2; capped by MAX_SEED_URLS_PER_JOB. */
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

/** One fetched URL within a crawl job (raw_documents). */
export interface RawDocument {
  id: string;
  crawlJobId: string;
  sourceId: string;
  url: string;
  contentType: string | null;
  /** Object-storage key of the stored payload; null when status is error/skipped. */
  storageKey: string | null;
  /** sha256 hex of the payload — enables change detection/dedup in Phase 3. */
  checksum: string | null;
  status: RawDocumentStatus;
  httpStatus: number | null;
  responseBytes: number | null;
  errorMessage: string | null;
  fetchedAt: string;
  createdAt: string;
}

// TODO(Phase 3): extraction hand-off contracts (raw_document -> staging JSON)
// are defined here when the AI transform layer is built.
