import { z } from "zod";
import {
  AI_DECISION_TYPES,
  PAGE_TYPES,
  RULE_TYPES,
  type AIReviewDecision,
  type AiObservationReviewInput,
  type AiRuleSuggestionInput,
  type AiStagedProductReviewInput,
} from "@dip/domain";

/**
 * The DIP AI-review instruction contract. ONE prompt shared by every provider;
 * adapters may add provider-specific wrappers (JSON-mode flags, stop tokens)
 * but the core contract lives here and nowhere else.
 */
export const DIP_REVIEW_SYSTEM_PROMPT = `You are DIP Engine's structured data review assistant for global beauty-product data.

Your ONLY job is to review one extraction leftover at a time and return a structured decision.

Rules you must always follow:
1. Judge ONLY from the evidence provided in the user payload (extracted candidates, confidences, observation context, master data context). NEVER invent facts that are not supported by that evidence.
2. Respond with STRICT JSON matching the "expected_response_schema" in the payload. No prose, no markdown fences, no comments — JSON only.
3. Resolve a field only when the evidence clearly supports one value. When evidence is weak or conflicting, leave the field in "unresolved_fields" instead of guessing.
4. Suggest a rule (in "suggested_rules") ONLY when you see a clearly repeatable pattern: a brand alias, a category/product-type keyword, a currency symbol mapping. One-off fixes are NOT rules. Allowed rule types are listed in "allowed_rule_types".
5. Every decision and every suggested rule carries a "confidence" between 0 and 1. Be conservative: prefer lower confidence over false certainty.
6. "decision_type" must be one of: "resolved" (all questions settled), "partially_resolved" (some fields settled), "unresolved" (evidence too weak), "rejected" (the item is not a real product candidate).
7. If the page type looks misclassified, set "page_type_suggestion"; otherwise leave it null.`;

/** JSON schema description embedded in every payload so any model knows the shape. */
const RESPONSE_SCHEMA_DESCRIPTION = {
  decision_type: `one of ${AI_DECISION_TYPES.join(" | ")}`,
  confidence_score: "number 0..1",
  resolved_fields: "object: field name -> resolved string value (may be empty)",
  unresolved_fields: "array of field names still unresolved",
  page_type_suggestion: `null or one of ${PAGE_TYPES.join(" | ")}`,
  suggested_rules: [
    {
      rule_type: `one of ${RULE_TYPES.join(" | ")}`,
      source_scope: "source slug or 'global'",
      match_key: "string to match",
      match_value: "string or null",
      normalized_key: "string or null",
      normalized_value: "string or null",
      confidence: "number 0..1",
      rationale: "short string or null",
    },
  ],
  notes: "short string or null",
};

export function buildStagedProductPayload(
  input: AiStagedProductReviewInput,
): Record<string, unknown> {
  return {
    task: "review_staged_product",
    item_type: "staged_product",
    item: {
      source: input.sourceSlug,
      url: input.sourceUrl,
      page_type: input.pageType,
      dominant_signal: input.dominantSignal,
      extracted: input.extracted,
      field_confidences: input.fieldConfidences,
      unresolved_fields: input.unresolvedFields,
      validation_status: input.validationStatus,
      validation_errors: input.validationErrors,
    },
    allowed_rule_types: RULE_TYPES,
    expected_response_schema: RESPONSE_SCHEMA_DESCRIPTION,
  };
}

export function buildObservationPayload(input: AiObservationReviewInput): Record<string, unknown> {
  return {
    task: "review_observation",
    item_type: "observation",
    item: {
      source: input.sourceSlug,
      observation_type: input.observationType,
      field_name: input.fieldName,
      raw_value: input.rawValue,
      suggested_value: input.suggestedValue,
      notes: input.notes,
    },
    allowed_rule_types: RULE_TYPES,
    expected_response_schema: RESPONSE_SCHEMA_DESCRIPTION,
  };
}

export function buildRuleSuggestionPayload(input: AiRuleSuggestionInput): Record<string, unknown> {
  return {
    task: "suggest_rule",
    item_type: "rule_request",
    item: {
      source: input.sourceSlug,
      context: input.context,
      rule_type_hint: input.ruleTypeHint,
    },
    allowed_rule_types: RULE_TYPES,
    expected_response_schema: RESPONSE_SCHEMA_DESCRIPTION,
  };
}

/** Strict schema for provider output — anything else is a failed review item. */
const decisionSchema = z.object({
  decision_type: z.enum(AI_DECISION_TYPES),
  confidence_score: z.number().min(0).max(1),
  resolved_fields: z.record(z.string(), z.string()).default({}),
  unresolved_fields: z.array(z.string()).default([]),
  page_type_suggestion: z.enum(PAGE_TYPES).nullable().default(null),
  suggested_rules: z
    .array(
      z.object({
        rule_type: z.enum(RULE_TYPES),
        source_scope: z.string().min(1).default("global"),
        match_key: z.string().min(1),
        match_value: z.string().nullable().default(null),
        normalized_key: z.string().nullable().default(null),
        normalized_value: z.string().nullable().default(null),
        confidence: z.number().min(0).max(1),
        rationale: z.string().nullable().default(null),
      }),
    )
    .default([]),
  notes: z.string().nullable().default(null),
});

export interface DecisionMeta {
  providerName: string;
  modelName: string;
  traceId: string | null;
}

/**
 * Parse and validate raw model output into the internal decision object.
 * Tolerates accidental markdown fences (some models add them despite JSON
 * mode); everything else must match the schema exactly.
 */
export function parseDecision(rawText: string, meta: DecisionMeta): AIReviewDecision {
  const stripped = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripped);
  } catch {
    throw new Error(`AI response is not valid JSON (provider: ${meta.providerName})`);
  }

  const result = decisionSchema.safeParse(parsedJson);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`AI response failed schema validation: ${issues}`);
  }

  const decision = result.data;
  return {
    decisionType: decision.decision_type,
    confidenceScore: decision.confidence_score,
    resolvedFields: decision.resolved_fields,
    unresolvedFields: decision.unresolved_fields,
    pageTypeSuggestion: decision.page_type_suggestion,
    suggestedRules: decision.suggested_rules.map((rule) => ({
      ruleType: rule.rule_type,
      sourceScope: rule.source_scope,
      matchKey: rule.match_key,
      matchValue: rule.match_value,
      normalizedKey: rule.normalized_key,
      normalizedValue: rule.normalized_value,
      confidence: rule.confidence,
      rationale: rule.rationale,
    })),
    notes: decision.notes,
    providerName: meta.providerName,
    modelName: meta.modelName,
    traceId: meta.traceId,
    rawResponse: rawText,
  };
}
