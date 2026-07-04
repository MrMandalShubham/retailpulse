import { describe, expect, it } from "vitest";
import {
  buildObservationPayload,
  buildStagedProductPayload,
  DIP_REVIEW_SYSTEM_PROMPT,
  parseDecision,
} from "../src/prompt.js";

const META = { providerName: "test", modelName: "test-model", traceId: "trace-1" };

const VALID_DECISION = {
  decision_type: "resolved",
  confidence_score: 0.9,
  resolved_fields: { brand: "COSRX" },
  unresolved_fields: [],
  page_type_suggestion: null,
  suggested_rules: [
    {
      rule_type: "brand_alias",
      source_scope: "global",
      match_key: "cosrx",
      match_value: null,
      normalized_key: null,
      normalized_value: "COSRX",
      confidence: 0.9,
      rationale: "seen alias",
    },
  ],
  notes: null,
};

describe("system prompt", () => {
  it("carries the non-negotiable instruction contract", () => {
    expect(DIP_REVIEW_SYSTEM_PROMPT).toContain("NEVER invent facts");
    expect(DIP_REVIEW_SYSTEM_PROMPT).toContain("STRICT JSON");
    expect(DIP_REVIEW_SYSTEM_PROMPT).toContain("repeatable pattern");
  });
});

describe("payload builders", () => {
  it("embeds staged product evidence and the response schema", () => {
    const payload = buildStagedProductPayload({
      sourceSlug: "test-store",
      sourceUrl: "https://shop.test/p/1",
      pageType: "product",
      dominantSignal: "jsonld_product",
      extracted: { name: "Serum", brand: null },
      fieldConfidences: { name: 0.9 },
      unresolvedFields: ["brand"],
      validationStatus: "needs_review",
      validationErrors: [],
    });
    expect(payload.task).toBe("review_staged_product");
    expect((payload.item as Record<string, unknown>).unresolved_fields).toEqual(["brand"]);
    expect(payload.expected_response_schema).toBeDefined();
    expect(payload.allowed_rule_types).toContain("brand_alias");
  });

  it("embeds observation context", () => {
    const payload = buildObservationPayload({
      sourceSlug: "test-store",
      observationType: "unknown_brand",
      fieldName: "brand",
      rawValue: "drjart",
      suggestedValue: "Dr. Jart+",
      notes: null,
    });
    expect(payload.task).toBe("review_observation");
    expect((payload.item as Record<string, unknown>).raw_value).toBe("drjart");
  });
});

describe("parseDecision", () => {
  it("parses a valid strict-JSON decision", () => {
    const decision = parseDecision(JSON.stringify(VALID_DECISION), META);
    expect(decision.decisionType).toBe("resolved");
    expect(decision.resolvedFields.brand).toBe("COSRX");
    expect(decision.suggestedRules[0]?.ruleType).toBe("brand_alias");
    expect(decision.providerName).toBe("test");
    expect(decision.traceId).toBe("trace-1");
    expect(decision.rawResponse).toContain("cosrx");
  });

  it("tolerates accidental markdown fences", () => {
    const fenced = "```json\n" + JSON.stringify(VALID_DECISION) + "\n```";
    expect(parseDecision(fenced, META).decisionType).toBe("resolved");
  });

  it("applies defaults for optional collections", () => {
    const minimal = parseDecision(
      JSON.stringify({ decision_type: "unresolved", confidence_score: 0.3 }),
      META,
    );
    expect(minimal.suggestedRules).toEqual([]);
    expect(minimal.resolvedFields).toEqual({});
    expect(minimal.pageTypeSuggestion).toBeNull();
  });

  it("rejects non-JSON, bad enums, and out-of-range confidence", () => {
    expect(() => parseDecision("the brand is probably COSRX", META)).toThrow(/not valid JSON/);
    expect(() =>
      parseDecision(JSON.stringify({ decision_type: "maybe", confidence_score: 0.5 }), META),
    ).toThrow(/schema validation/);
    expect(() =>
      parseDecision(JSON.stringify({ decision_type: "resolved", confidence_score: 1.5 }), META),
    ).toThrow(/schema validation/);
  });
});
