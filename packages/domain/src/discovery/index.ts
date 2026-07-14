/**
 * Product-discovery domain (Phase 0) — vocabularies + contracts for the thin,
 * upstream "map product pages before ingesting" layer.
 *
 * Phase 0 is a lean MAP: for each source it answers "which product pages exist
 * (id + name + url), and where is each in the ingestion lifecycle". It does NOT
 * extract, normalize product fields, enrich, or promote.
 *
 * The map row is deliberately 8 columns. Identity is (source_id, product_id) —
 * the source's own native product id. The join key to canonical is
 * normalized_url (via @dip/promotion normalizeSourceUrl — the SAME normalizer
 * product_sources uses), so a discovered page links to its canonical product
 * after promotion. One status axis: batch_status (the ingestion lifecycle).
 */

/** How a source is discovered. sitemap + category_crawl are implemented; the
 *  rest are reserved so later strategies slot in without a schema change. */
export const DISCOVERY_STRATEGIES = [
  "sitemap",
  "category_crawl",
  "pagination",
  "js_render",
  "manual",
] as const;
export type DiscoveryStrategy = (typeof DISCOVERY_STRATEGIES)[number];

export const DISCOVERY_RUN_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export type DiscoveryRunStatus = (typeof DISCOVERY_RUN_STATUSES)[number];

/** The ingestion lifecycle of a discovered page (the map's one status axis). */
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

/**
 * One discovered product page — the lean Phase 0 map/queue row (8 columns).
 *  - Identity: (sourceId, productId) — the source's own native product id.
 *  - productUrl: the page the ingestion pipeline visits to scrape.
 *  - normalizedUrl: canonical form; dedup + join key to product_sources.source_url.
 *  - batchStatus: the ingestion lifecycle (pending → queued → ingested → promoted).
 */
export interface DiscoveredProductPage {
  id: string;
  sourceId: string;
  productId: string;
  productName: string | null;
  productUrl: string;
  normalizedUrl: string;
  batchStatus: BatchStatus;
  createdAt: string;
}
