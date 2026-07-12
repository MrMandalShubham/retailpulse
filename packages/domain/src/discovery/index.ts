/**
 * Product-discovery domain (Phase 0) — vocabularies + contracts for the thin,
 * upstream "map product pages before ingesting" layer.
 *
 * Slice 0a is sitemap-first and DETERMINISTIC: robots.txt + sitemap discovery →
 * normalize + hash URLs → upsert a lightweight mapping row. It does NOT extract,
 * normalize product fields, enrich, or promote — it only answers "which product
 * pages exist, and where are they in the ingestion lifecycle".
 *
 * Two orthogonal status axes (deliberate):
 *  - discovery_status: is this actually a product page?  candidate → confirmed /
 *    rejected / stale
 *  - batch_status: where is it in the ingestion lifecycle? pending → queued →
 *    ingested → promoted / failed / skipped
 */

/** How a source is discovered. Only 'sitemap' is implemented in slice 0a;
 *  the rest are reserved so later slices slot in without a schema change. */
export const DISCOVERY_STRATEGIES = [
  "sitemap",
  "category_crawl",
  "pagination",
  "js_render",
  "manual",
] as const;
export type DiscoveryStrategy = (typeof DISCOVERY_STRATEGIES)[number];

/** How an individual page URL was found. */
export const DISCOVERY_METHODS = [
  "sitemap",
  "category_crawl",
  "pagination",
  "js_render",
  "manual",
  "ai_verified",
] as const;
export type DiscoveryMethod = (typeof DISCOVERY_METHODS)[number];

export const DISCOVERY_RUN_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export type DiscoveryRunStatus = (typeof DISCOVERY_RUN_STATUSES)[number];

/** Axis 1 — is this a real product page? */
export const DISCOVERY_STATUSES = ["candidate", "confirmed", "rejected", "stale"] as const;
export type DiscoveryStatus = (typeof DISCOVERY_STATUSES)[number];

/** Axis 2 — ingestion lifecycle of a discovered page. */
export const BATCH_STATUSES = [
  "pending",
  "queued",
  "ingested",
  "promoted",
  "failed",
  "skipped",
] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/** Per-source discovery configuration (stored as jsonb on sources). */
export interface DiscoveryConfig {
  strategy: DiscoveryStrategy;
  /** Optional cap on URLs discovered per run (safety). */
  maxUrls?: number;

  // --- sitemap strategy ---
  /** Explicit sitemap URL; if absent, discovered via robots.txt / /sitemap.xml. */
  sitemapUrl?: string;
  /** Regex a URL must match to count as a confirmed product page. If absent,
   *  discovered URLs are stored as 'candidate' (we can't be sure they're products). */
  productUrlRegex?: string;

  // --- category_crawl strategy (paginated JSON product API) ---
  /** Product-list API endpoint (POST, JSON). */
  categoryApiUrl?: string;
  /** Category ids to page through. */
  categoryNos?: string[];
  /** Product URL prefix; the product id is appended (e.g. ".../detail?prdtNo="). */
  productUrlBase?: string;
  /** Products requested per page (default 100). */
  rowsPerPage?: number;
  /** Extra fields merged into the POST body (site-specific constants). */
  requestTemplate?: Record<string, unknown>;
  /** Safety cap on pages per category. */
  maxPagesPerCategory?: number;
}

/** Audit row for one discovery execution. */
export interface DiscoveryRun {
  id: string;
  sourceId: string;
  strategy: DiscoveryStrategy;
  status: DiscoveryRunStatus;
  urlsDiscovered: number;
  newUrls: number;
  updatedUrls: number;
  errors: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One discovered product page (the mapping/queue row). */
export interface DiscoveredProductPage {
  id: string;
  sourceId: string;
  sourceSlug: string | null;
  discoveredProductName: string | null;
  productUrl: string;
  normalizedUrl: string;
  urlHash: string;
  discoveryMethod: DiscoveryMethod;
  pageTypeConfidence: number | null;
  crawlDepth: number;
  parentListingUrl: string | null;
  candidateMarketId: string | null;
  discoveryStatus: DiscoveryStatus;
  batchStatus: BatchStatus;
  canonicalProductId: string | null;
  discoveryRunId: string | null;
  errorReason: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}
