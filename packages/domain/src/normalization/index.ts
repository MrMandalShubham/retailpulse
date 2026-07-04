/**
 * Normalization domain — contracts for turning extracted raw data into clean
 * records for the 8 normalized V1 tables. Implementations (AI + deterministic
 * rules, unit/currency conversion, alias mapping) arrive in Phase 3, largely in
 * the Python transform services; these types define the shared boundary.
 */

export const VALIDATION_VERDICTS = ["valid", "suspect", "invalid"] as const;
export type ValidationVerdict = (typeof VALIDATION_VERDICTS)[number];

/** Result of normalizing one raw input into a candidate clean record. */
export interface NormalizationResult<TClean> {
  verdict: ValidationVerdict;
  /** Present when verdict is "valid" or "suspect". */
  record: TClean | null;
  /** Human/AI-readable reasons behind a suspect or invalid verdict. */
  issues: string[];
  /** 0–100 confidence/quality score, feeds products_master.data_quality_score. */
  qualityScore: number;
}

/** Boundary interface for a normalizer from a raw shape to a clean shape. */
export interface Normalizer<TRaw, TClean> {
  normalize(input: TRaw): Promise<NormalizationResult<TClean>>;
}

// TODO(Phase 3): concrete normalizers (product fields, prices, review rollups)
// and canonical alias-mapping contracts are added when the transform layer is built.
