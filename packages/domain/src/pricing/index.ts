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

// TODO(Phase 3): price normalization contracts (currency conversion, unit price
// derivation) are defined here when the normalization service is implemented.
