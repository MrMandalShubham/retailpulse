/**
 * Monitoring configuration for the clean DIP (discover → ingest → clean-load).
 * Everything the dashboard knows about the engine's tables and phases is
 * declared here; the generic queries are generated from this config.
 */

export type Layer = "discovery" | "ingest" | "clean";

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
  // ---- Ingestion-control layer ----
  {
    table: "sources",
    label: "Sources",
    layer: "ingest",
    importantColumns: ["name", "slug", "base_url"],
    dedupKey: ["slug"],
  },
  {
    table: "crawl_jobs",
    label: "Ingest Runs",
    layer: "ingest",
    importantColumns: ["status"],
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
    importantColumns: [
      "product_id",
      "product_name",
      "product_url",
      "normalized_url",
      "batch_status",
    ],
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
  {
    table: "oliveyoung_global_product_snapshots",
    label: "Olive Young — Daily Snapshots",
    layer: "clean",
    createdAtColumn: "captured_at",
    importantColumns: ["product_id", "captured_at"],
    dedupKey: ["product_id", "captured_at"],
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
    key: "ingest_clean",
    name: "Ingest & Clean",
    runTable: "crawl_jobs",
    statusColumn: "status",
    startedColumn: "started_at",
    finishedColumn: "finished_at",
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
