/**
 * Monitoring configuration for the clean DIP (discover → ingest → clean-load).
 * Everything the dashboard knows about the engine's tables and phases is
 * declared here; the generic queries are generated from this config.
 */

export type Layer = "discovery" | "raw" | "clean";

export interface TableMonitor {
  table: string;
  label: string;
  layer: Layer;
  /** Column used for "latest insert" (defaults to created_at when present). */
  createdAtColumn?: string;
  /** Business-critical columns to null-check. */
  importantColumns: string[];
  /** Business key for duplicate detection. */
  dedupKey?: string[];
  /** True for the end-product table (highlighted in the UI). */
  core?: boolean;
}

export const CORE_TABLES: TableMonitor[] = [
  // ---- Raw / ingestion layer ----
  {
    table: "sources",
    label: "Sources",
    layer: "raw",
    importantColumns: ["name", "slug", "base_url"],
    dedupKey: ["slug"],
  },
  {
    table: "crawl_jobs",
    label: "Crawl Jobs",
    layer: "raw",
    importantColumns: ["status"],
  },
  {
    table: "raw_documents",
    label: "Raw Documents",
    layer: "raw",
    createdAtColumn: "fetched_at",
    importantColumns: ["url", "storage_key", "status", "checksum"],
  },

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

  // ---- Clean per-platform store (the end product) ----
  {
    table: "oliveyoung_global_products",
    label: "Olive Young — Clean Products",
    layer: "clean",
    core: true,
    importantColumns: [
      "name_en",
      "brand_name",
      "category_l1",
      "regular_price",
      "primary_image",
      "avg_rating",
    ],
    dedupKey: ["product_id"],
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
    name: "Raw API Ingestion",
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
    key: "clean_store",
    name: "Clean Product Store",
    runTable: null,
    statusColumn: "",
    startedColumn: "",
    finishedColumn: "",
    processedColumn: null,
    failedColumn: null,
    outputTable: "oliveyoung_global_products",
  },
];

/** Alerting thresholds. */
export const THRESHOLDS = {
  nullRatePctWarn: 25,
  nullRatePctCrit: 60,
  duplicateWarn: 1,
};
