/**
 * Clean DIP schema (post middle-chain retirement). The engine is now
 * discover → ingest → clean-load, so only these tables remain:
 *   - raw/ingestion layer: sources, crawl_jobs, raw_documents
 *   - Phase 0 discovery map: discovery_runs, discovered_product_pages
 *   - per-platform clean store (the end product): oliveyoung_global_products
 *
 * The normalized core 8 + staging/AI/promotion/facts/enrichment tables were
 * retired with the middle chain (restore via git tag pre-retire-middle-chain).
 */

// Raw ELT layer
export { sources, crawlJobs, rawDocuments } from "./ingestion.js";

// Product-discovery layer (Phase 0)
export { discoveryRuns, discoveredProductPages } from "./discovery.js";

// Per-platform clean product store — the end product + time-series snapshots
export {
  oliveyoungGlobalProducts,
  oliveyoungGlobalProductSnapshots,
} from "./platform-oliveyoung.js";
