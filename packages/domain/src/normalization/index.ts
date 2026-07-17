/**
 * Normalization domain — the hybrid transform/staging layer (Phase 3).
 *
 * Three-layer rule this module enforces by design:
 *   raw = immutable evidence · staging = regenerable working data ·
 *   canonical 8-table core = curated truth, written only via explicit
 *   promotion (Phase 4 — interfaces below, zero implementations).
 *
 * The learning loop is first-class: deterministic extraction → local rules →
 * unresolved leftovers become transform_observations → (future AI review) →
 * repeated resolutions become normalization_rules rows → next run needs less AI.
 */

export const TRANSFORM_RUN_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export type TransformRunStatus = (typeof TRANSFORM_RUN_STATUSES)[number];

export const PAGE_TYPES = ["product", "listing", "non_product", "unknown"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const EXTRACTION_METHODS = [
  "api_json",
  "jsonld",
  "opengraph",
  "meta_tags",
  "dom_heuristic",
  "url_hint",
  "rule_inferred",
  "mixed",
] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

export const VALIDATION_STATUSES = ["pending", "valid", "invalid", "needs_review"] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export const RULE_TYPES = [
  "brand_alias",
  "category_keyword",
  "product_type_keyword",
  "currency_hint",
  "selector_hint",
  "regex_pattern",
  "ignore_pattern",
] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export const OBSERVATION_TYPES = [
  "unknown_brand",
  "unknown_category",
  "unknown_product_type",
  "conflicting_price",
  "weak_product_candidate",
  "unseen_pattern",
  "missing_required_field",
] as const;
export type ObservationType = (typeof OBSERVATION_TYPES)[number];

export const OBSERVATION_STATUSES = ["open", "ignored", "resolved", "promoted_to_rule"] as const;
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];

/** source_scope value meaning "applies to every source". */
export const GLOBAL_RULE_SCOPE = "global";

/**
 * Trust weight per extraction method. Structured data beats heuristics;
 * rule_inferred is high because rules are confirmed knowledge.
 * "mixed" is a record-level label only, never a candidate method.
 */
export const METHOD_WEIGHTS: Record<ExtractionMethod, number> = {
  // First-party structured API data (Phase 1 envelopes) — the site's own
  // source of truth, above any page-derived signal.
  api_json: 0.98,
  jsonld: 0.9,
  rule_inferred: 0.85,
  opengraph: 0.75,
  meta_tags: 0.7,
  dom_heuristic: 0.5,
  url_hint: 0.35,
  mixed: 0,
};

/** A field with best confidence below this lands in unresolved_fields. */
export const UNRESOLVED_CONFIDENCE_THRESHOLD = 0.6;
/** Minimum record confidence for canonical promotion eligibility. */
export const PROMOTION_CONFIDENCE_THRESHOLD = 0.8;
/** Minimum normalized string similarity for a fuzzy brand/category match. */
export const FUZZY_MATCH_THRESHOLD = 0.85;
/** Max total unresolved fields a staged product may carry and still promote. */
export const MAX_UNRESOLVED_FIELDS_FOR_PROMOTION = 2;
/** Same-brand name similarity at/above which a canonical match is accepted. */
export const AUTO_MATCH_SIMILARITY_THRESHOLD = 0.9;
/** Similarity band floor: [floor, auto) is AMBIGUOUS — the record stays staged. */
export const AMBIGUOUS_SIMILARITY_FLOOR = 0.75;

// ---------------------------------------------------------------------------
// Canonical promotion vocabularies (Phase 5)
// ---------------------------------------------------------------------------

export const PROMOTION_RUN_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export type PromotionRunStatus = (typeof PROMOTION_RUN_STATUSES)[number];

export const PROMOTION_TRIGGER_TYPES = ["batch", "single"] as const;
export type PromotionTriggerType = (typeof PROMOTION_TRIGGER_TYPES)[number];

export const PROMOTION_DECISIONS = [
  "promoted_new",
  "matched_existing",
  "skipped_ineligible",
  "skipped_ambiguous",
  "rejected",
  "failed",
] as const;
export type PromotionDecision = (typeof PROMOTION_DECISIONS)[number];

export const MATCH_STRATEGIES = [
  "source_url",
  "exact_brand_name",
  "fuzzy_brand_name",
  "new_product",
] as const;
export type MatchStrategy = (typeof MATCH_STRATEGIES)[number];

export const PRODUCT_MEDIA_TYPES = ["image", "video"] as const;
export type ProductMediaType = (typeof PRODUCT_MEDIA_TYPES)[number];

/** One transform execution (transform_runs). */
export interface TransformRun {
  id: string;
  crawlJobId: string | null;
  sourceId: string | null;
  status: TransformRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  totalDocuments: number;
  processedDocuments: number;
  succeededDocuments: number;
  failedDocuments: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One product candidate extracted from a raw document (staged_products). */
export interface StagedProduct {
  id: string;
  transformRunId: string;
  rawDocumentId: string;
  sourceId: string;
  sourceUrl: string | null;
  pageType: PageType | null;
  /** Main reason the page was classified the way it was. */
  dominantSignal: string | null;
  extractedName: string | null;
  extractedBrand: string | null;
  extractedCategory: string | null;
  extractedProductType: string | null;
  extractedDescription: string | null;
  extractedCurrency: string | null;
  extractedPriceText: string | null;
  extractedRatingText: string | null;
  primaryImageUrl: string | null;
  extractionMethod: ExtractionMethod | null;
  confidenceScore: number | null;
  validationStatus: ValidationStatus;
  validationErrors: string[];
  normalizedPayload: Record<string, unknown>;
  fieldCandidates: Record<string, unknown>;
  fieldConfidences: Record<string, number>;
  unresolvedFields: string[];
  aiRecommended: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Reusable normalization logic / learned mapping (normalization_rules). */
export interface NormalizationRule {
  id: string;
  ruleType: RuleType;
  /** Source slug the rule applies to, or "global". */
  sourceScope: string;
  matchKey: string;
  matchValue: string | null;
  normalizedKey: string | null;
  normalizedValue: string | null;
  /** Lower number = applied first. */
  priority: number;
  active: boolean;
  notes: string | null;
  learnedFromAi: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Unresolved or interesting leftover for future AI review (transform_observations). */
export interface TransformObservation {
  id: string;
  transformRunId: string;
  stagedProductId: string | null;
  rawDocumentId: string;
  observationType: ObservationType;
  fieldName: string | null;
  rawValue: string | null;
  suggestedValue: string | null;
  confidenceScore: number | null;
  status: ObservationStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Promotion boundary (Phase 4) — contracts only, ZERO canonical writes now.
// ---------------------------------------------------------------------------

export interface PromotionEligibilityInput {
  validationStatus: ValidationStatus;
  pageType: PageType | null;
  confidenceScore: number | null;
  extractedName: string | null;
  extractedBrand: string | null;
  unresolvedFields: string[];
}

export interface PromotionEligibility {
  eligible: boolean;
  /** Human-readable reasons why the record is NOT eligible (empty when eligible). */
  reasons: string[];
}

/**
 * Pure eligibility contract for promoting a staged product into the canonical
 * core. Deciding is Phase 3; actually promoting (brand/category FK resolution,
 * slug/dedup policy, controlled insert) is Phase 4.
 */
export function evaluatePromotionEligibility(
  input: PromotionEligibilityInput,
): PromotionEligibility {
  const reasons: string[] = [];
  if (input.validationStatus !== "valid") {
    reasons.push(`validation_status is '${input.validationStatus}', requires 'valid'`);
  }
  if (input.pageType !== "product") {
    reasons.push(`page_type is '${input.pageType ?? "null"}', requires 'product'`);
  }
  if ((input.confidenceScore ?? 0) < PROMOTION_CONFIDENCE_THRESHOLD) {
    reasons.push(
      `confidence_score ${input.confidenceScore ?? "null"} is below ${PROMOTION_CONFIDENCE_THRESHOLD}`,
    );
  }
  if (!input.extractedName?.trim()) {
    reasons.push("extracted_name is missing");
  }
  if (!input.extractedBrand?.trim()) {
    reasons.push("extracted_brand is missing");
  }
  for (const critical of ["name", "brand"]) {
    if (input.unresolvedFields.includes(critical)) {
      reasons.push(`critical field '${critical}' is unresolved`);
    }
  }
  if (input.unresolvedFields.length > MAX_UNRESOLVED_FIELDS_FOR_PROMOTION) {
    reasons.push(
      `${input.unresolvedFields.length} unresolved fields exceed the limit of ${MAX_UNRESOLVED_FIELDS_FOR_PROMOTION}`,
    );
  }
  return { eligible: reasons.length === 0, reasons };
}

/**
 * TODO(Phase 4): implemented by the controlled promotion service — resolves
 * brand/category/product_type FKs against master data, applies slug/dedup
 * policy, and performs the ONLY sanctioned write path into the canonical core.
 */
export interface PromotionService {
  promoteStagedProduct(stagedProductId: string): Promise<{ productId: string }>;
}

/**
 * TODO(Phase 4): the AI-review loop implements this — an AI (or operator)
 * resolves an observation and, when the resolution is reusable, promotes it to
 * a normalization_rules row (learned_from_ai = true) so the next run does not
 * need AI for the same case.
 */
export interface ObservationResolutionService {
  resolve(
    observationId: string,
    resolution: { suggestedValue: string; notes?: string },
  ): Promise<void>;
  promoteToRule(
    observationId: string,
    rule: Pick<
      NormalizationRule,
      "ruleType" | "sourceScope" | "matchKey" | "matchValue" | "normalizedKey" | "normalizedValue"
    > & { learnedFromAi: boolean },
  ): Promise<{ ruleId: string }>;
}
