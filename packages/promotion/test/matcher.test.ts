import { describe, expect, it } from "vitest";
import { pickMatch } from "../src/matcher.js";
import { slugify } from "../src/text.js";

const CANDIDATES = [
  { id: "p1", name: "Advanced Snail 96 Mucin Power Essence 100ml" },
  { id: "p2", name: "Low pH Good Morning Gel Cleanser" },
];

describe("pickMatch", () => {
  it("matches exact folded names regardless of case/punctuation", () => {
    const result = pickMatch("advanced snail 96 mucin power essence 100ML", CANDIDATES);
    expect(result).toEqual({
      kind: "matched",
      productId: "p1",
      strategy: "exact_brand_name",
      score: 1,
    });
  });

  it("auto-matches very similar names (>= 0.9) when their numbers agree", () => {
    const result = pickMatch("Advanced Snail 96 Mucin Power Essence 100 ml", CANDIDATES);
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.strategy).toBe("fuzzy_brand_name");
      expect(result.score).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("keeps size/volume variants ambiguous instead of forcing a merge", () => {
    // Same product family, different size: high edit similarity but the
    // numeric tokens disagree — must NOT silently merge.
    const result = pickMatch("Advanced Snail 96 Mucin Power Essence 250ml", CANDIDATES);
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidateId).toBe("p1");
      expect(result.score).toBeGreaterThanOrEqual(0.75);
    }
  });

  it("returns none for genuinely different products", () => {
    expect(pickMatch("Green Tea Seed Serum 80ml", CANDIDATES).kind).toBe("none");
  });

  it("returns none when the brand has no products yet", () => {
    expect(pickMatch("Anything", []).kind).toBe("none");
  });
});

describe("slugify", () => {
  it("produces url-safe slugs", () => {
    expect(slugify("Dr. Jart+ Ceramidin™ Cream")).toBe("dr-jart-ceramidin-cream");
    expect(slugify("COSRX Advanced Snail 96")).toBe("cosrx-advanced-snail-96");
  });
});
