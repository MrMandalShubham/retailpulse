/**
 * Enrichment domain (Phase 7) — provider-agnostic contracts for filling
 * beauty-product attributes with FULL provenance.
 *
 * Rules this layer encodes:
 * - Layered: deterministic (regex/rule) first, AI only for the rest.
 * - Fill-if-null only — never overwrites an existing canonical value.
 * - Never fabricate: a value is written only when grounded in evidence;
 *   otherwise the field is left null with a recorded reason (needs_source).
 * - AI-derived values are review-gated (proposed → approved → applied).
 * - Every enrichment carries source, method, confidence, timestamp.
 */

export const ENRICHMENT_METHODS = [
  "regex", // literal pattern match in source text
  "rule", // deterministic mapping/heuristic (e.g. category → domain)
  "ai_classified", // AI inference over existing data
  "ai_extracted", // AI pulling a value from source text
  "reference", // from a brand/reference source
] as const;
export type EnrichmentMethod = (typeof ENRICHMENT_METHODS)[number];

export const ENRICHMENT_STATUSES = [
  "proposed", // awaiting review (AI / heuristic outputs)
  "applied", // written to canonical (fill-if-null)
  "rejected", // operator declined
  "needs_source", // could not derive confidently; value stays null
] as const;
export type EnrichmentStatus = (typeof ENRICHMENT_STATUSES)[number];

export const ENRICHMENT_SOURCE_TYPES = ["product_page", "brand_reference", "derived"] as const;
export type EnrichmentSourceType = (typeof ENRICHMENT_SOURCE_TYPES)[number];

export const ENRICHMENT_RUN_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export type EnrichmentRunStatus = (typeof ENRICHMENT_RUN_STATUSES)[number];

export type EnrichmentTier = "deterministic" | "ai_classify" | "ai_extract";
export type EnrichmentValueKind = "scalar" | "integer" | "numeric" | "array";

/**
 * The field registry — the single source of truth for what can be enriched.
 * Adding a new enrichable attribute = one entry here (extensible by design).
 */
export interface EnrichableField {
  field: string;
  /** products_master column this fills (fill-if-null), or null if sidecar-only. */
  column: string | null;
  valueKind: EnrichmentValueKind;
  tier: EnrichmentTier;
  /** Deterministic literal/clean-mapping fields apply directly; heuristic/AI
   *  fields are review-gated (proposed, not auto-applied). */
  autoApply: boolean;
}

export const ENRICHABLE_FIELDS: EnrichableField[] = [
  {
    field: "spf_value",
    column: "spf_value",
    valueKind: "integer",
    tier: "deterministic",
    autoApply: true,
  },
  {
    field: "pa_rating",
    column: "pa_rating",
    valueKind: "scalar",
    tier: "deterministic",
    autoApply: true,
  },
  {
    field: "size_value",
    column: "size_value",
    valueKind: "numeric",
    tier: "deterministic",
    autoApply: true,
  },
  {
    field: "size_unit",
    column: "size_unit",
    valueKind: "scalar",
    tier: "deterministic",
    autoApply: true,
  },
  {
    field: "texture",
    column: "texture",
    valueKind: "scalar",
    tier: "deterministic",
    autoApply: true,
  },
  {
    field: "domain",
    column: "domain",
    valueKind: "scalar",
    tier: "deterministic",
    autoApply: true,
  },
  // Heuristic — review-gated for published/report safety.
  {
    field: "price_segment",
    column: "price_segment",
    valueKind: "scalar",
    tier: "ai_classify",
    autoApply: false,
  },
  // Tier 3 (needs richer real text) — registry-ready, run later.
  {
    field: "skin_types",
    column: "skin_types",
    valueKind: "array",
    tier: "ai_extract",
    autoApply: false,
  },
  {
    field: "skin_concerns",
    column: "skin_concerns",
    valueKind: "array",
    tier: "ai_extract",
    autoApply: false,
  },
  {
    field: "key_claims",
    column: "key_claims",
    valueKind: "array",
    tier: "ai_extract",
    autoApply: false,
  },
  {
    field: "ingredient_highlights",
    column: "ingredient_highlights",
    valueKind: "array",
    tier: "ai_extract",
    autoApply: false,
  },
];

/** Output of an extractor: a grounded value or an honest "not found". */
export type ExtractionOutcome =
  | {
      found: true;
      value: string; // scalar; arrays are JSON-encoded by the writer
      valueJson?: unknown;
      confidence: number;
      method: EnrichmentMethod;
      evidence: string; // the matched snippet / reasoning
    }
  | { found: false; reason: string };

export interface ProductEnrichment {
  id: string;
  productId: string;
  fieldName: string;
  value: string | null;
  valueJson: unknown | null;
  method: EnrichmentMethod;
  confidence: number | null;
  sourceUrl: string | null;
  sourceType: EnrichmentSourceType;
  evidence: string | null;
  status: EnrichmentStatus;
  reason: string | null;
  enrichmentRunId: string | null;
  createdAt: string;
  updatedAt: string;
}
