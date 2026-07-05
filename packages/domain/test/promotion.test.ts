import { describe, expect, it } from "vitest";
import { evaluatePromotionEligibility } from "../src/normalization/index.js";

const ELIGIBLE_INPUT = {
  validationStatus: "valid" as const,
  pageType: "product" as const,
  confidenceScore: 0.9,
  extractedName: "Hydrating Serum 50ml",
  extractedBrand: "COSRX",
  unresolvedFields: [],
};

describe("evaluatePromotionEligibility", () => {
  it("accepts a valid, confident, fully-resolved product candidate", () => {
    const result = evaluatePromotionEligibility(ELIGIBLE_INPUT);
    expect(result.eligible).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("rejects low confidence and explains why", () => {
    const result = evaluatePromotionEligibility({ ...ELIGIBLE_INPUT, confidenceScore: 0.5 });
    expect(result.eligible).toBe(false);
    expect(result.reasons.join(" ")).toContain("below 0.8");
  });

  it("rejects non-product pages, missing brand, and unresolved critical fields", () => {
    const result = evaluatePromotionEligibility({
      ...ELIGIBLE_INPUT,
      pageType: "listing",
      extractedBrand: null,
      unresolvedFields: ["brand"],
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toHaveLength(3);
  });

  it("rejects records with too many unresolved fields", () => {
    const result = evaluatePromotionEligibility({
      ...ELIGIBLE_INPUT,
      unresolvedFields: ["category", "product_type", "image"],
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons.join(" ")).toContain("exceed the limit");
  });

  it("rejects needs_review records regardless of confidence", () => {
    const result = evaluatePromotionEligibility({
      ...ELIGIBLE_INPUT,
      validationStatus: "needs_review",
    });
    expect(result.eligible).toBe(false);
  });
});
