/**
 * Reviews domain — monthly analytical rating metrics per product, market, and platform.
 * voice_pulse_reviews is the monthly analytical version only in V1 (approved decision).
 * It is append-only: one row per product/market/platform/month, inserted by the
 * transform step. Alert-style/event-level review data belongs to a future table.
 */

/** Monthly review metrics fact (voice_pulse_reviews). */
export interface VoicePulseReview {
  id: string;
  productId: string;
  marketId: string;
  platform: string;
  /** First day of the observed month, ISO-8601 date. */
  periodMonth: string;
  /** 0–5 scale. */
  avgRating: number | null;
  reviewCount: number | null;
  /** 0–100 percentage. */
  recommendationPct: number | null;
  /** 0–100 percentage. */
  repurchasePct: number | null;
  createdAt: string;
}

// TODO(Phase 3): review aggregation contracts (platform ingestion → monthly rollup)
// are defined here when the transform layer is implemented.
