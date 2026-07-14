/**
 * Monitoring configuration layer.
 *
 * Everything the observability dashboard knows about DIP Engine's tables and
 * phases is declared here — the queries are GENERATED from this config. To
 * monitor a new table or phase, add a row here; no query code changes.
 * (This is the "configuration layer with placeholder mappings" the dashboard
 * spec asks for — here filled in with DIP Engine's real tables.)
 */

export type Layer = "discovery" | "raw" | "staging" | "ai" | "canonical" | "facts";

export interface TableMonitor {
  table: string;
  label: string;
  layer: Layer;
  /** Column used for "latest insert" (defaults to created_at when present). */
  createdAtColumn?: string;
  /** Business-critical columns to null-check. */
  importantColumns: string[];
  /** Business key for duplicate detection (omit for append-only evidence). */
  dedupKey?: string[];
  /** True for the 8 canonical V1 core tables (highlighted in the UI). */
  core?: boolean;
}

export const CORE_TABLES: TableMonitor[] = [
  // ---- Discovery (Phase 0) ----
  {
    table: "discovery_runs",
    label: "Discovery Runs",
    layer: "discovery",
    importantColumns: ["strategy", "status"],
  },
  {
    table: "discovered_product_pages",
    label: "Discovered Product Pages",
    layer: "discovery",
    importantColumns: ["product_id", "product_name", "product_url", "normalized_url", "batch_status"],
    dedupKey: ["source_id", "product_id"],
  },

  // ---- Canonical V1 core (the 8) ----
  {
    table: "products_master",
    label: "Products (canonical)",
    layer: "canonical",
    core: true,
    importantColumns: [
      "name",
      "slug",
      "brand_id",
      "category_id",
      "product_type_id",
      "primary_image_url",
      "data_quality_score",
    ],
    dedupKey: ["slug"],
  },
  {
    table: "brands",
    label: "Brands",
    layer: "canonical",
    core: true,
    importantColumns: ["name", "slug"],
    dedupKey: ["slug"],
  },
  {
    table: "categories",
    label: "Categories",
    layer: "canonical",
    core: true,
    importantColumns: ["name", "slug"],
    dedupKey: ["slug"],
  },
  {
    table: "product_types",
    label: "Product Types",
    layer: "canonical",
    core: true,
    importantColumns: ["name", "slug", "category_id"],
    dedupKey: ["slug"],
  },
  {
    table: "markets",
    label: "Markets",
    layer: "canonical",
    core: true,
    importantColumns: ["name", "code"],
    dedupKey: ["code"],
  },
  {
    table: "product_markets",
    label: "Product Markets (bridge)",
    layer: "canonical",
    core: true,
    createdAtColumn: null as unknown as string,
    importantColumns: ["product_id", "market_id", "status"],
    dedupKey: ["product_id", "market_id"],
  },
  {
    table: "retail_pulse_prices",
    label: "Retail Pulse Prices (fact)",
    layer: "canonical",
    core: true,
    importantColumns: ["product_id", "market_id", "regular_price", "currency", "week_ending"],
    dedupKey: ["product_id", "market_id", "retailer", "week_ending"],
  },
  {
    table: "voice_pulse_reviews",
    label: "Voice Pulse Reviews (fact)",
    layer: "canonical",
    core: true,
    importantColumns: ["product_id", "market_id", "avg_rating", "period_month"],
    dedupKey: ["product_id", "market_id", "platform", "period_month"],
  },

  // ---- Raw evidence ----
  {
    table: "raw_documents",
    label: "Raw Documents",
    layer: "raw",
    createdAtColumn: "fetched_at",
    importantColumns: ["url", "storage_key", "status", "checksum"],
  },

  // ---- Staging / transform ----
  {
    table: "staged_products",
    label: "Staged Products",
    layer: "staging",
    importantColumns: ["extracted_name", "source_url", "validation_status", "confidence_score"],
  },
  {
    table: "transform_observations",
    label: "Transform Observations",
    layer: "staging",
    importantColumns: ["observation_type", "status"],
  },
  {
    table: "normalization_rules",
    label: "Normalization Rules",
    layer: "staging",
    importantColumns: ["rule_type", "match_key"],
    dedupKey: ["rule_type", "source_scope", "match_key"],
  },

  // ---- AI review ----
  {
    table: "ai_review_items",
    label: "AI Review Items",
    layer: "ai",
    importantColumns: ["status", "provider_name", "parsed_decision"],
  },
  {
    table: "ai_rule_suggestions",
    label: "AI Rule Suggestions",
    layer: "ai",
    importantColumns: ["rule_type", "match_key", "status"],
  },

  // ---- Promotion / search / provenance ----
  {
    table: "promotion_items",
    label: "Promotion Items (audit)",
    layer: "canonical",
    importantColumns: ["decision"],
  },
  {
    table: "product_sources",
    label: "Product Sources (provenance)",
    layer: "canonical",
    importantColumns: ["product_id", "source_url"],
    dedupKey: ["source_url"],
  },
  {
    table: "product_search_documents",
    label: "Search Documents",
    layer: "facts",
    createdAtColumn: "updated_at",
    importantColumns: ["product_id", "search_text", "search_vector"],
  },

  // ---- Fact / history ----
  {
    table: "product_price_facts",
    label: "Price Facts",
    layer: "facts",
    createdAtColumn: "recorded_at",
    importantColumns: ["product_id", "price_value", "price_currency", "observed_at", "source_url"],
    dedupKey: ["product_id", "source_url", "observed_at"],
  },
  {
    table: "product_rating_facts",
    label: "Rating Facts",
    layer: "facts",
    createdAtColumn: "recorded_at",
    importantColumns: ["product_id", "rating_value", "observed_at", "source_url"],
    dedupKey: ["product_id", "source_url", "observed_at"],
  },
];

export interface PhaseMonitor {
  id: number;
  key: string;
  name: string;
  /** Run/audit table for this phase (null when the phase has no run table). */
  runTable: string | null;
  statusColumn: string;
  startedColumn: string;
  finishedColumn: string;
  /** Numeric columns → { processed, failed } for aggregate throughput. */
  processedColumn: string | null;
  failedColumn: string | null;
  /** Table whose rows are this phase's output (for counts). */
  outputTable: string;
}

export const PHASES: PhaseMonitor[] = [
  {
    id: 0,
    key: "discovery",
    name: "Product Discovery",
    runTable: "discovery_runs",
    statusColumn: "status",
    startedColumn: "started_at",
    finishedColumn: "finished_at",
    processedColumn: "urls_discovered",
    failedColumn: "errors",
    outputTable: "discovered_product_pages",
  },
  {
    id: 1,
    key: "raw_ingestion",
    name: "Raw Ingestion",
    runTable: "crawl_jobs",
    statusColumn: "status",
    startedColumn: "started_at",
    finishedColumn: "finished_at",
    processedColumn: null,
    failedColumn: null,
    outputTable: "raw_documents",
  },
  {
    id: 2,
    key: "transform",
    name: "Transform / Staging",
    runTable: "transform_runs",
    statusColumn: "status",
    startedColumn: "started_at",
    finishedColumn: "finished_at",
    processedColumn: "processed_documents",
    failedColumn: "failed_documents",
    outputTable: "staged_products",
  },
  {
    id: 3,
    key: "ai_review",
    name: "AI Review / Enrichment",
    runTable: "ai_review_runs",
    statusColumn: "status",
    startedColumn: "started_at",
    finishedColumn: "finished_at",
    processedColumn: "processed_items",
    failedColumn: "failed_items",
    outputTable: "ai_review_items",
  },
  {
    id: 4,
    key: "promotion",
    name: "Canonical Promotion",
    runTable: "promotion_runs",
    statusColumn: "status",
    startedColumn: "started_at",
    finishedColumn: "finished_at",
    processedColumn: "total_items",
    failedColumn: "failed_items",
    outputTable: "products_master",
  },
  {
    id: 5,
    key: "search",
    name: "Search Document Layer",
    runTable: null,
    statusColumn: "",
    startedColumn: "",
    finishedColumn: "",
    processedColumn: null,
    failedColumn: null,
    outputTable: "product_search_documents",
  },
  {
    id: 6,
    key: "facts",
    name: "Fact / History Layer",
    runTable: "fact_runs",
    statusColumn: "status",
    startedColumn: "started_at",
    finishedColumn: "finished_at",
    processedColumn: "products_considered",
    failedColumn: "skipped_invalid",
    outputTable: "product_price_facts",
  },
];

/** Alerting thresholds (tunable — later move to env/role config). */
export const THRESHOLDS = {
  nullRatePctWarn: 25, // an important column null in > this % of rows
  nullRatePctCrit: 60,
  stuckRecordsWarn: 5, // stuck-between-phases count that raises a warning
  duplicateWarn: 1, // any dup on a unique-expected business key
};
