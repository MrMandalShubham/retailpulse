/**
 * Ingestion domain — contracts for the scraping/collection side of the platform.
 * Phase 1 defines the shared vocabulary only. Implementations (source registry,
 * scheduler, Redis queue, Python scraper workers) arrive in Phase 2.
 */

export const CRAWL_JOB_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "dead_letter",
] as const;
export type CrawlJobStatus = (typeof CRAWL_JOB_STATUSES)[number];

/** Configuration for a scrape source (a website/marketplace/review platform). */
export interface SourceConfig {
  id: string;
  name: string;
  baseUrl: string;
  /** Whether pages need a headless browser (dynamic) or plain HTTP (static). */
  rendering: "static" | "dynamic";
  /** Requests per minute allowed against this source. */
  rateLimitRpm: number;
  enabled: boolean;
}

/** A unit of scraping work produced by the scheduler and consumed by workers. */
export interface CrawlJob {
  id: string;
  sourceId: string;
  url: string;
  status: CrawlJobStatus;
  attempts: number;
  scheduledAt: string;
}

// TODO(Phase 2): source registry CRUD contracts, scheduler cadence types, and the
// queue payload schema shared with the Python scraper workers.
