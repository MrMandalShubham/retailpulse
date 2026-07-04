import type {
  AIReviewDecision,
  AIReviewProvider,
  AiObservationReviewInput,
  AiRuleSuggestionInput,
  AiStagedProductReviewInput,
} from "@dip/domain";
import { parseDecision } from "../prompt.js";

/**
 * Deterministic mock provider for tests and local development.
 * Produces plausible canned decisions from simple heuristics, composes them as
 * raw JSON text, and pushes that text through the SAME parseDecision() used
 * for real providers — so every mock call also exercises the parser.
 */

const PRODUCT_TYPE_KEYWORDS = [
  "essence",
  "serum",
  "cream",
  "sunscreen",
  "toner",
  "cleanser",
  "mask",
  "lotion",
  "balm",
  "oil",
];

const PROVIDER_NAME = "mock";

export function createMockProvider(modelName = "mock-reviewer-v1"): AIReviewProvider {
  const emit = (decision: Record<string, unknown>): AIReviewDecision =>
    parseDecision(JSON.stringify(decision), {
      providerName: PROVIDER_NAME,
      modelName,
      traceId: null,
    });

  return {
    providerName: PROVIDER_NAME,
    modelName,

    async reviewObservation(input: AiObservationReviewInput) {
      switch (input.observationType) {
        case "unknown_brand": {
          if (!input.rawValue) return emit(unresolved("no raw brand value provided", 0.2));
          const normalized = input.suggestedValue ?? input.rawValue;
          return emit({
            decision_type: "resolved",
            confidence_score: 0.9,
            resolved_fields: { brand: normalized },
            unresolved_fields: [],
            page_type_suggestion: null,
            suggested_rules: [
              {
                rule_type: "brand_alias",
                source_scope: "global",
                match_key: fold(input.rawValue),
                match_value: null,
                normalized_key: null,
                normalized_value: normalized,
                confidence: 0.9,
                rationale: "brand alias observed in extraction evidence",
              },
            ],
            notes: null,
          });
        }
        case "unknown_product_type": {
          const keyword = findKeyword(input.rawValue);
          if (!keyword) return emit(unresolved("no recognizable product-type keyword", 0.3));
          return emit({
            decision_type: "resolved",
            confidence_score: 0.85,
            resolved_fields: { product_type: capitalize(keyword) },
            unresolved_fields: [],
            page_type_suggestion: null,
            suggested_rules: [
              {
                rule_type: "product_type_keyword",
                source_scope: "global",
                match_key: keyword,
                match_value: null,
                normalized_key: null,
                normalized_value: capitalize(keyword),
                confidence: 0.85,
                rationale: `product name contains the repeatable keyword '${keyword}'`,
              },
            ],
            notes: null,
          });
        }
        case "unknown_category": {
          const segment = input.rawValue?.includes(">")
            ? (input.rawValue.split(">")[0] ?? "").trim()
            : null;
          if (!segment)
            return emit(unresolved("category text has no clear top-level segment", 0.35));
          return emit({
            decision_type: "resolved",
            confidence_score: 0.8,
            resolved_fields: { category: segment },
            unresolved_fields: [],
            page_type_suggestion: null,
            suggested_rules: [
              {
                rule_type: "category_keyword",
                source_scope: "global",
                match_key: fold(segment),
                match_value: null,
                normalized_key: null,
                normalized_value: segment,
                confidence: 0.8,
                rationale: "top-level breadcrumb segment is a repeatable category keyword",
              },
            ],
            notes: null,
          });
        }
        default:
          return emit(
            unresolved(`observation type '${input.observationType}' needs more evidence`, 0.4),
          );
      }
    },

    async reviewStagedProduct(input: AiStagedProductReviewInput) {
      if (!input.extracted.name) {
        return emit({
          decision_type: "rejected",
          confidence_score: 0.2,
          resolved_fields: {},
          unresolved_fields: input.unresolvedFields,
          page_type_suggestion: "non_product",
          suggested_rules: [],
          notes: "no product name in evidence — not a real product candidate",
        });
      }
      const resolvedFields: Record<string, string> = {};
      for (const field of input.unresolvedFields) {
        const value = input.extracted[field];
        if (value) resolvedFields[field] = value;
      }
      const stillUnresolved = input.unresolvedFields.filter((f) => !(f in resolvedFields));
      return emit({
        decision_type: stillUnresolved.length === 0 ? "resolved" : "partially_resolved",
        confidence_score: 0.75,
        resolved_fields: resolvedFields,
        unresolved_fields: stillUnresolved,
        page_type_suggestion: null,
        suggested_rules: [],
        notes: null,
      });
    },

    async suggestRule(input: AiRuleSuggestionInput) {
      if (!input.ruleTypeHint) return emit(unresolved("no rule type hint provided", 0.3));
      const keyword = findKeyword(input.context) ?? fold(input.context).split(" ")[0] ?? "";
      if (!keyword) return emit(unresolved("context yields no usable match key", 0.3));
      return emit({
        decision_type: "resolved",
        confidence_score: 0.7,
        resolved_fields: {},
        unresolved_fields: [],
        page_type_suggestion: null,
        suggested_rules: [
          {
            rule_type: input.ruleTypeHint,
            source_scope: "global",
            match_key: keyword,
            match_value: null,
            normalized_key: null,
            normalized_value: capitalize(keyword),
            confidence: 0.7,
            rationale: "derived from provided context",
          },
        ],
        notes: null,
      });
    },
  };
}

function unresolved(note: string, confidence: number): Record<string, unknown> {
  return {
    decision_type: "unresolved",
    confidence_score: confidence,
    resolved_fields: {},
    unresolved_fields: [],
    page_type_suggestion: null,
    suggested_rules: [],
    notes: note,
  };
}

function findKeyword(text: string | null | undefined): string | null {
  if (!text) return null;
  const folded = ` ${fold(text)} `;
  return PRODUCT_TYPE_KEYWORDS.find((keyword) => folded.includes(` ${keyword} `)) ?? null;
}

function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
