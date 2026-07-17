/**
 * Transform over Phase 1 direct-API envelopes: tryParseEnvelope detection,
 * field mapping, category-path splitting, and processDocument end-to-end
 * (classification short-circuit + normalized payload + validation).
 */
import { describe, expect, it } from "vitest";
import {
  extractFromEnvelope,
  splitCategoryPath,
  tryParseEnvelope,
} from "../src/transform/extract/envelope.js";
import {
  processDocument,
  type EligibleRawDocument,
  type MasterData,
} from "../src/transform/pipeline.js";
import { createRuleEngine } from "../src/transform/normalize/rule-engine.js";

const ENVELOPE = {
  product_id: "GA260339051",
  source: "oliveyoung-global",
  source_url: "https://global.oliveyoung.com/product/detail?prdtNo=GA260339051",
  fetched_at: "2026-07-16T00:00:00.000Z",
  endpoints: {
    "detail-data": {
      product: {
        prdtNo: "GA260339051",
        prdtNameEn: "celimax Retinal Shot Tightening Booster 15ml Set (+3ml)",
        prdtName: "celimax Retinal Shot Tightening Booster 15ml Set (+3ml)",
        brandName: "celimax",
        allPathCtgrNameEn: "OliveYoungGlobal &gt; Skincare &gt; Moisturizers &gt; Essence & Serum",
        nrmlAmt: 24.0,
        saleAmt: 18.48,
        gdsCd: "8809700321918",
        prdtGbnCode: "10",
        imagePath: "prdtImg/1847/07fa8fb7-a6e6-460a-974d-7dc8bc4eae97.jpg",
      },
    },
    "details-info": {
      details: {
        whyWeLoveItText: "Retinal firming care with deeper penetration.",
        ftrdIngrdText: "Nano liposome retinal.",
        howToUseText: "Apply in the evening.",
      },
    },
    "review-summary": { totalStarRate: 4.7, totalReviewCount: 1356 },
  },
  http_status: { "detail-data": 200, "details-info": 200, "review-summary": 200 },
};

const document: EligibleRawDocument = {
  id: "doc-1",
  sourceId: "src-1",
  sourceSlug: "oliveyoung-global",
  url: ENVELOPE.source_url,
  storageKey: "raw/oliveyoung-global/2026-07-16/job/GA260339051.json",
};
const engine = createRuleEngine([], "oliveyoung-global");
const EMPTY_MASTER: MasterData = { brands: [], categories: [], productTypes: [] };

describe("tryParseEnvelope", () => {
  it("detects an envelope payload", () => {
    expect(tryParseEnvelope(JSON.stringify(ENVELOPE))).not.toBeNull();
  });
  it("rejects HTML and non-envelope JSON", () => {
    expect(tryParseEnvelope("<!doctype html><html></html>")).toBeNull();
    expect(tryParseEnvelope('{"foo": 1}')).toBeNull();
    expect(tryParseEnvelope("not json at all")).toBeNull();
  });
});

describe("splitCategoryPath", () => {
  it("drops the site root, returns first segment + leaf", () => {
    expect(
      splitCategoryPath("OliveYoungGlobal &gt; Skincare &gt; Moisturizers &gt; Essence & Serum"),
    ).toEqual({ category: "Skincare", productType: "Essence & Serum" });
  });
  it("handles a single-level path without duplicating category as type", () => {
    expect(splitCategoryPath("OliveYoungGlobal &gt; Skincare")).toEqual({
      category: "Skincare",
      productType: null,
    });
  });
  it("handles null", () => {
    expect(splitCategoryPath(null)).toEqual({ category: null, productType: null });
  });
});

describe("extractFromEnvelope", () => {
  const extraction = extractFromEnvelope(ENVELOPE as never, document.url);
  const value = (field: string) => extraction.candidates.get(field)?.[0]?.value;

  it("maps every report-critical field with the api_json method", () => {
    expect(value("name")).toContain("celimax Retinal Shot");
    expect(value("brand")).toBe("celimax");
    expect(value("category")).toBe("Skincare");
    expect(value("product_type")).toBe("Essence & Serum");
    expect(value("price_text")).toBe("USD 18.48"); // sale price = what a shopper pays
    expect(value("currency")).toBe("USD");
    expect(value("rating_text")).toBe("4.7/5 (1356 reviews)");
    expect(value("image")).toBe(
      "https://cdn-image.oliveyoung.com/prdtImg/1847/07fa8fb7-a6e6-460a-974d-7dc8bc4eae97.jpg",
    );
    expect(value("description")).toContain("Retinal firming care");
    for (const list of extraction.candidates.values()) {
      expect(list.every((c) => c.method === "api_json")).toBe(true);
    }
  });

  it("omits rating when the product has no reviews", () => {
    const noReviews = {
      ...ENVELOPE,
      endpoints: { ...ENVELOPE.endpoints, "review-summary": { totalStarRate: 0, totalReviewCount: 0 } },
    };
    const ex = extractFromEnvelope(noReviews as never, document.url);
    expect(ex.candidates.get("rating_text")).toBeUndefined();
  });
});

describe("processDocument over an envelope", () => {
  const result = processDocument(document, JSON.stringify(ENVELOPE), engine, EMPTY_MASTER);

  it("classifies as product via the api_envelope signal and stages a valid record", () => {
    expect(result.staged).not.toBeNull();
    const staged = result.staged!;
    expect(staged.pageType).toBe("product");
    expect(staged.dominantSignal).toBe("api_envelope");
    expect(staged.extractionMethod).toBe("api_json");
    expect(staged.validationStatus).toBe("valid");
    expect(Number(staged.confidenceScore)).toBeGreaterThanOrEqual(0.8);
    expect(staged.unresolvedFields).toEqual([]);
    expect(staged.aiRecommended).toBe(false);
  });

  it("fills the normalized payload the facts pipeline reads (price + rating)", () => {
    const payload = result.staged!.normalizedPayload as {
      price: { value: number; currency: string | null };
      rating: { value: number; reviewCount: number | null };
      productType: string | null;
    };
    expect(payload.price).toMatchObject({ value: 18.48, currency: "USD" });
    expect(payload.rating).toMatchObject({ value: 4.7, reviewCount: 1356 });
    expect(payload.productType).toBe("Essence & Serum");
  });

  it("still runs the HTML path for non-envelope payloads", () => {
    const htmlResult = processDocument(
      { ...document, storageKey: "raw/x.html" },
      "<!doctype html><html><head><title>Some Page</title></head><body></body></html>",
      engine,
      EMPTY_MASTER,
    );
    // Junk HTML must not be classified via the envelope path.
    expect(htmlResult.staged?.dominantSignal ?? "none").not.toBe("api_envelope");
  });
});
