import { describe, expect, it } from "vitest";
import { createMockProvider } from "../src/providers/mock.js";

const provider = createMockProvider();

describe("mock provider", () => {
  it("suggests a brand_alias rule for unknown_brand observations", async () => {
    const decision = await provider.reviewObservation({
      sourceSlug: "test-store",
      observationType: "unknown_brand",
      fieldName: "brand",
      rawValue: "Dr.Jart+",
      suggestedValue: "Dr. Jart+",
      notes: null,
    });
    expect(decision.decisionType).toBe("resolved");
    expect(decision.resolvedFields.brand).toBe("Dr. Jart+");
    expect(decision.suggestedRules).toHaveLength(1);
    expect(decision.suggestedRules[0]).toMatchObject({
      ruleType: "brand_alias",
      matchKey: "dr jart",
      normalizedValue: "Dr. Jart+",
    });
    expect(decision.providerName).toBe("mock");
  });

  it("derives a product_type_keyword rule from a name containing a known keyword", async () => {
    const decision = await provider.reviewObservation({
      sourceSlug: "test-store",
      observationType: "unknown_product_type",
      fieldName: "product_type",
      rawValue: "Advanced Snail 96 Mucin Power Essence 100ml",
      suggestedValue: null,
      notes: null,
    });
    expect(decision.suggestedRules[0]).toMatchObject({
      ruleType: "product_type_keyword",
      matchKey: "essence",
      normalizedValue: "Essence",
    });
  });

  it("derives a category_keyword rule from a breadcrumb", async () => {
    const decision = await provider.reviewObservation({
      sourceSlug: "test-store",
      observationType: "unknown_category",
      fieldName: "category",
      rawValue: "Skincare > Essence",
      suggestedValue: null,
      notes: null,
    });
    expect(decision.suggestedRules[0]).toMatchObject({
      ruleType: "category_keyword",
      matchKey: "skincare",
      normalizedValue: "Skincare",
    });
  });

  it("stays unresolved on conflicting_price (no rule invention)", async () => {
    const decision = await provider.reviewObservation({
      sourceSlug: "test-store",
      observationType: "conflicting_price",
      fieldName: "price_text",
      rawValue: "$21.99 / $18.00",
      suggestedValue: null,
      notes: null,
    });
    expect(decision.decisionType).toBe("unresolved");
    expect(decision.suggestedRules).toHaveLength(0);
  });

  it("rejects staged candidates without a name and resolves fields it can", async () => {
    const rejected = await provider.reviewStagedProduct({
      sourceSlug: "test-store",
      sourceUrl: null,
      pageType: "unknown",
      dominantSignal: null,
      extracted: { name: null },
      fieldConfidences: {},
      unresolvedFields: ["name", "brand"],
      validationStatus: "needs_review",
      validationErrors: [],
    });
    expect(rejected.decisionType).toBe("rejected");

    const partial = await provider.reviewStagedProduct({
      sourceSlug: "test-store",
      sourceUrl: null,
      pageType: "product",
      dominantSignal: "jsonld_product",
      extracted: { name: "Serum", brand: "cosrx", price_text: null },
      fieldConfidences: { name: 0.9 },
      unresolvedFields: ["brand", "price_text"],
      validationStatus: "needs_review",
      validationErrors: [],
    });
    expect(partial.decisionType).toBe("partially_resolved");
    expect(partial.resolvedFields.brand).toBe("cosrx");
    expect(partial.unresolvedFields).toEqual(["price_text"]);
  });
});
