/**
 * Report-intelligence domain (Phase 8) — vocabularies + contracts for the
 * additive report layer: commercial (sales) facts, media/news facts, and
 * brand-attribute provenance.
 *
 * Rules this layer encodes:
 * - sales_facts / news_facts are APPEND-ONLY facts (same discipline as Phase 6):
 *   pipelines only INSERT with a UNIQUE dedup anchor; nothing updates/deletes.
 * - market_id is nullable on facts: null = honestly unknown (source unmapped).
 * - brand_facts is a provenance sidecar mirroring product_enrichments — it
 *   reuses ENRICHMENT_METHODS / STATUSES / SOURCE_TYPES and enrichment_runs,
 *   and is review-gated (proposed → applied).
 * - Every row carries source_url + confidence; a value is only written when
 *   grounded in evidence.
 */

// --- Sales (commercial) facts -------------------------------------------------

/** Retail/commercial channel a sales signal was observed on. */
export const SALES_CHANNELS = [
  "online",
  "offline",
  "marketplace",
  "dtc",
  "wholesale",
  "unknown",
] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

/**
 * The commercial metric a sales_facts row carries (EAV-lite: one table covers
 * heterogeneous signals via metric + metric_value, rather than 20 columns).
 */
export const SALES_METRICS = [
  "units_sold",
  "revenue",
  "rank",
  "review_velocity",
  "restock_count",
  "popularity_index",
  "sold_out",
] as const;
export type SalesMetric = (typeof SALES_METRICS)[number];

/** Time grain a sales observation covers. */
export const PERIOD_GRAINS = ["day", "week", "month", "quarter", "snapshot"] as const;
export type PeriodGrain = (typeof PERIOD_GRAINS)[number];

// --- News / media facts -------------------------------------------------------

/** Kind of media/news/event mention. */
export const NEWS_TYPES = [
  "article",
  "press_release",
  "campaign",
  "launch",
  "award",
  "social_post",
  "editorial",
  "event",
  "other",
] as const;
export type NewsType = (typeof NEWS_TYPES)[number];

/** Editorial classification of a news item (optional). */
export const NEWS_CATEGORIES = [
  "product_launch",
  "marketing",
  "sustainability",
  "controversy",
  "partnership",
  "retail_expansion",
  "award",
  "other",
] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

/** Sentiment label of a news item (optional). */
export const SENTIMENTS = ["positive", "neutral", "negative", "mixed"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

// --- Contracts ----------------------------------------------------------------

/** Append-only commercial observation (sales_facts). */
export interface SalesFact {
  id: string;
  productId: string;
  sourceId: string | null;
  sourceSlug: string | null;
  /** null = market honestly unknown (source unmapped). */
  marketId: string | null;
  channel: SalesChannel;
  /** 'observed' = direct source evidence; 'derived' reserved for computed. */
  factType: string;
  metric: SalesMetric;
  metricValue: number;
  /** ISO 4217, uppercased — only for revenue-type metrics. */
  metricCurrency: string | null;
  metricUnit: string | null;
  periodGrain: PeriodGrain;
  periodStart: string;
  periodEnd: string | null;
  observedAt: string;
  recordedAt: string;
  confidenceScore: number | null;
  sourceUrl: string;
  evidence: string | null;
  factRunId: string | null;
}

/** Append-only media/news/event observation (news_facts). At least one of
 *  productId / brandId is set (enforced by a CHECK constraint). */
export interface NewsFact {
  id: string;
  productId: string | null;
  brandId: string | null;
  sourceId: string | null;
  sourceSlug: string | null;
  marketId: string | null;
  newsType: NewsType;
  category: NewsCategory | null;
  sentiment: Sentiment | null;
  /** −1..1 when available. */
  sentimentScore: number | null;
  title: string | null;
  summary: string | null;
  /** The article/media URL. */
  url: string;
  publishedAt: string | null;
  observedAt: string;
  recordedAt: string;
  confidenceScore: number | null;
  /** Where we captured it (provenance), distinct from `url`. */
  sourceUrl: string;
  evidence: string | null;
  factRunId: string | null;
}

/** Brand-attribute provenance record (brand_facts) — the brand analog of
 *  product_enrichments. Reuses EnrichmentMethod / Status / SourceType. */
export interface BrandFact {
  id: string;
  brandId: string;
  fieldName: string;
  value: string | null;
  valueJson: unknown | null;
  method: string;
  confidence: number | null;
  sourceUrl: string | null;
  sourceType: string;
  evidence: string | null;
  status: string;
  reason: string | null;
  enrichmentRunId: string | null;
  createdAt: string;
  updatedAt: string;
}
