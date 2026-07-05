/**
 * Pricing domain — weekly price observations per product, market, and retailer.
 * retail_pulse_prices is an append-only fact table in V1: rows are inserted by
 * the transform step and never updated or deleted.
 */

/** Weekly price fact (retail_pulse_prices). */
export interface RetailPulsePrice {
  id: string;
  productId: string;
  marketId: string;
  retailer: string;
  regularPrice: number | null;
  promoPrice: number | null;
  /** ISO 4217, e.g. "USD", "JPY". */
  currency: string;
  /** Date of the Sunday (or business-defined day) closing the observed week. */
  weekEnding: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Fact layer (Phase 6) — vocabularies shared by price AND rating facts.
// Facts are append-only history: never overwritten, never deleted by pipelines.
// ---------------------------------------------------------------------------

export const FACT_RUN_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export type FactRunStatus = (typeof FACT_RUN_STATUSES)[number];

/**
 * 'observed' = taken directly from source evidence (all Phase 6 facts).
 * 'derived' = reserved for future computed facts (e.g. currency-converted
 * benchmarks) — no pipeline writes it yet.
 */
export const FACT_TYPES = ["observed", "derived"] as const;
export type FactType = (typeof FACT_TYPES)[number];

/** A product with facts whose latest observation is older than this is stale. */
export const STALE_FACT_DAYS = 30;

/** Validation bounds for plausible prices (matches the Phase 3 parser). */
export const MIN_PLAUSIBLE_PRICE = 0.01;
export const MAX_PLAUSIBLE_PRICE = 100_000_000;

/** Append-only price observation (product_price_facts). */
export interface ProductPriceFact {
  id: string;
  productId: string;
  sourceId: string | null;
  sourceSlug: string | null;
  stagedProductId: string | null;
  /** null = market honestly unknown (source unmapped). */
  marketId: string | null;
  factType: FactType | null;
  priceValue: number;
  priceCurrency: string;
  priceOriginalText: string | null;
  observedAt: string;
  recordedAt: string;
  confidenceScore: number | null;
  sourceUrl: string;
  factRunId: string | null;
}

/** Append-only rating observation (product_rating_facts). */
export interface ProductRatingFact {
  id: string;
  productId: string;
  sourceId: string | null;
  sourceSlug: string | null;
  stagedProductId: string | null;
  marketId: string | null;
  factType: FactType | null;
  /** Normalized 0–5 (the transform layer only converts explicit scales). */
  ratingValue: number;
  ratingScale: string;
  reviewCount: number | null;
  ratingOriginalText: string | null;
  observedAt: string;
  recordedAt: string;
  confidenceScore: number | null;
  sourceUrl: string;
  factRunId: string | null;
}
