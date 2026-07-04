/**
 * AI enrichment domain — provider-agnostic AI review contracts (Phase 4).
 *
 * Design rules this module encodes:
 * - Business logic talks to these interfaces, NEVER to a vendor SDK/API.
 *   Vendor adapters live in @dip/ai/providers and are selected by config.
 * - AI output is ADVISORY and STRUCTURED: decisions and rule suggestions land
 *   in audit tables; nothing is promoted without the controlled approval path.
 * - AI is selective: only unresolved, high-value leftovers are escalated.
 * - The canonical 8-table core stays untouched by anything in this layer.
 */

import type { ObservationType, PageType, RuleType } from "../normalization/index.js";

export const AI_REVIEW_RUN_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export type AiReviewRunStatus = (typeof AI_REVIEW_RUN_STATUSES)[number];

export const AI_REVIEW_ITEM_STATUSES = ["pending", "succeeded", "failed", "rejected"] as const;
export type AiReviewItemStatus = (typeof AI_REVIEW_ITEM_STATUSES)[number];

export const AI_REVIEW_ITEM_TYPES = ["staged_product", "observation"] as const;
export type AiReviewItemType = (typeof AI_REVIEW_ITEM_TYPES)[number];

export const AI_RULE_SUGGESTION_STATUSES = ["open", "approved", "rejected", "promoted"] as const;
export type AiRuleSuggestionStatus = (typeof AI_RULE_SUGGESTION_STATUSES)[number];

export const AI_DECISION_TYPES = [
  "resolved",
  "partially_resolved",
  "unresolved",
  "rejected",
] as const;
export type AiDecisionType = (typeof AI_DECISION_TYPES)[number];

/**
 * Observation types worth AI spend. unseen_pattern and weak_product_candidate
 * are deliberately EXCLUDED (approved decision): they are page-level noise
 * (homepages, listings, junk), not field-level questions AI can settle.
 */
export const AI_ELIGIBLE_OBSERVATION_TYPES = [
  "unknown_brand",
  "unknown_category",
  "unknown_product_type",
  "conflicting_price",
  "missing_required_field",
] as const satisfies readonly ObservationType[];

/** A rule candidate proposed by AI — stored in ai_rule_suggestions, never applied directly. */
export interface AiSuggestedRule {
  ruleType: RuleType;
  sourceScope: string;
  matchKey: string;
  matchValue: string | null;
  normalizedKey: string | null;
  normalizedValue: string | null;
  confidence: number;
  rationale: string | null;
}

/** Structured result of one AI review — never free text. */
export interface AIReviewDecision {
  decisionType: AiDecisionType;
  confidenceScore: number;
  resolvedFields: Record<string, string>;
  unresolvedFields: string[];
  pageTypeSuggestion: PageType | null;
  suggestedRules: AiSuggestedRule[];
  notes: string | null;
  providerName: string;
  modelName: string;
  /** Provider request/trace id when available. */
  traceId: string | null;
  /** Exact raw model output text, preserved for audit (output_payload). */
  rawResponse: string | null;
}

/** Evidence bundle for reviewing a staged product candidate. */
export interface AiStagedProductReviewInput {
  sourceSlug: string;
  sourceUrl: string | null;
  pageType: PageType | null;
  dominantSignal: string | null;
  extracted: Record<string, string | null>;
  fieldConfidences: Record<string, number>;
  unresolvedFields: string[];
  validationStatus: string;
  validationErrors: string[];
}

/** Evidence bundle for reviewing a transform observation. */
export interface AiObservationReviewInput {
  sourceSlug: string;
  observationType: ObservationType;
  fieldName: string | null;
  rawValue: string | null;
  suggestedValue: string | null;
  notes: string | null;
}

/** Free-standing rule suggestion request (context snippet + optional hint). */
export interface AiRuleSuggestionInput {
  sourceSlug: string;
  context: string;
  ruleTypeHint: RuleType | null;
}

/**
 * The ONLY interface business logic may use to talk to an AI model.
 * Implemented by @dip/ai providers (mistral, mock, future vendors).
 */
export interface AIReviewProvider {
  readonly providerName: string;
  readonly modelName: string;
  reviewStagedProduct(input: AiStagedProductReviewInput): Promise<AIReviewDecision>;
  reviewObservation(input: AiObservationReviewInput): Promise<AIReviewDecision>;
  suggestRule(input: AiRuleSuggestionInput): Promise<AIReviewDecision>;
}

/**
 * Orchestration contract: selects eligible records, builds payloads, calls the
 * configured provider, validates output, persists results. Implemented by the
 * worker's ai-review pipeline in Phase 4.
 */
export interface AIReviewService {
  runReviewCycle(): Promise<{
    runId: string | null;
    totalItems: number;
    succeededItems: number;
    failedItems: number;
    ruleSuggestions: number;
  }>;
}
