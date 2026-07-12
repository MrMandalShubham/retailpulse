/**
 * @dip/domain — shared domain contracts for DIP Engine.
 * Pure types and constants only: no runtime dependencies, no I/O.
 * Every other package depends on this one; this one depends on nothing.
 */

export * from "./catalog/index.js";
export * from "./taxonomy/index.js";
export * from "./markets/index.js";
export * from "./pricing/index.js";
export * from "./reviews/index.js";
export * from "./ingestion/index.js";
export * from "./raw-storage/index.js";
export * from "./normalization/index.js";
export * from "./ai-enrichment/index.js";
export * from "./enrichment/index.js";
export * from "./report/index.js";
export * from "./media/index.js";
export * from "./discovery/index.js";
