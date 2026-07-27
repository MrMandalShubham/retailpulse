/**
 * @dip/domain — shared domain contracts for DIP Engine.
 * Pure types and constants only: no runtime dependencies, no I/O.
 * Every other package depends on this one; this one depends on nothing.
 *
 * Scope tracks the storage-free 2-step engine (discover → ingest+clean):
 * only the ingestion-control and discovery contracts remain. The middle-chain
 * contracts (catalog, taxonomy, markets, pricing, reviews, normalization,
 * enrichment, report, media, raw-storage) were retired with the middle chain.
 */

export * from "./ingestion/index.js";
export * from "./discovery/index.js";
