/**
 * Clean DIP schema (storage-free 2-step engine). The engine is now
 * discover → ingest+clean, so only these tables remain:
 *   - ingestion-control layer: sources, crawl_jobs (fetch-run log)
 *   - Phase 0 discovery map: discovery_runs, discovered_product_pages
 *   - per-platform clean store (the end product): oliveyoung_global_products
 *     + oliveyoung_global_product_snapshots
 *
 * The raw layer (raw_documents + object storage) was dropped once ingestion
 * began writing the clean store directly. The normalized core 8 +
 * staging/AI/promotion/facts/enrichment tables were retired with the middle
 * chain (restore via git tag pre-retire-middle-chain).
 */

// Ingestion-control layer
export { sources, crawlJobs } from "./ingestion.js";

// Product-discovery layer (Phase 0)
export { discoveryRuns, discoveredProductPages } from "./discovery.js";

// Per-platform clean product store — the end product + time-series snapshots
export {
  oliveyoungGlobalProducts,
  oliveyoungGlobalProductSnapshots,
} from "./platform-oliveyoung.js";

// @cosme (Japan) — second per-platform clean store + snapshots
export { cosmeJpProducts, cosmeJpProductSnapshots } from "./platform-cosme.js";

// Dashboard serving layer — derived tables projected from the clean store by
// `pnpm distribute` (the dashboard reads these).
export {
  brands,
  categories,
  markets,
  retailProducts,
  productsMaster,
  productIngredients,
  voicePulseSentiment,
  productCategoryShare,
  productSalesHistory,
  brandMarketShare,
  retailPulseShelfShare,
} from "./serving.js";
