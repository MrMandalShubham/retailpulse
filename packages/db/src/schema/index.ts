/**
 * V1 normalized core (8 tables) + raw ELT layer (Phase 2), all in the default
 * (public) schema. The raw layer is a strictly separate data flow — nothing in
 * the core references it, and only the transform step (Phase 3+) will read raw
 * and write clean.
 */

// Normalized core (8 tables)
export { markets } from "./markets.js";
export { brands } from "./brands.js";
export { categories, productTypes } from "./taxonomy.js";
export { productsMaster, productMarkets } from "./products.js";
export { retailPulsePrices } from "./pricing.js";
export { voicePulseReviews } from "./reviews.js";

// Raw ELT layer (Phase 2)
export { sources, crawlJobs, rawDocuments } from "./ingestion.js";

// Staging / hybrid transform layer (Phase 3) — regenerable, never canonical
export {
  transformRuns,
  stagedProducts,
  normalizationRules,
  transformObservations,
} from "./transform.js";

// AI review layer (Phase 4) — advisory audit records, controlled rule promotion
export { aiReviewRuns, aiReviewItems, aiRuleSuggestions } from "./ai-review.js";

// Canonical promotion layer (Phase 5) — audit trail, provenance, media, search
export {
  promotionRuns,
  promotionItems,
  productSources,
  productMedia,
  productSearchDocuments,
} from "./promotion.js";

// Fact + market-mapping layer (Phase 6) — append-only history, honest mapping
export { sourceMarkets, factRuns, productPriceFacts, productRatingFacts } from "./facts.js";

// Enrichment provenance layer (Phase 7) — additive, fill-if-null, review-gated
export { enrichmentRuns, productEnrichments } from "./enrichment.js";
