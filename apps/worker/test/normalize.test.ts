import { describe, expect, it } from "vitest";
import { bestMatch, similarity } from "../src/transform/normalize/fuzzy.js";
import { parsePriceText } from "../src/transform/normalize/price.js";
import { parseRatingText } from "../src/transform/normalize/rating.js";
import { cleanText, fold } from "../src/transform/normalize/text.js";
import { normalizeImageUrl, stripTracking } from "../src/transform/normalize/urls.js";

const SYMBOLS = new Map([
  ["₩", "KRW"],
  ["US$", "USD"],
  ["$", "USD"],
  ["€", "EUR"],
]);

describe("text helpers", () => {
  it("cleans whitespace and returns null for empty", () => {
    expect(cleanText("  Snail\n  Essence \t 100ml ")).toBe("Snail Essence 100ml");
    expect(cleanText("   ")).toBeNull();
  });

  it("folds punctuation and case so aliases collide", () => {
    expect(fold("Dr. Jart+")).toBe(fold("dr jart"));
    expect(fold("COSRX")).toBe("cosrx");
  });
});

describe("parsePriceText", () => {
  it("parses symbol currencies with thousand separators", () => {
    expect(parsePriceText("₩12,900", SYMBOLS)).toEqual({ value: 12900, currency: "KRW", raw: "₩12,900" });
    expect(parsePriceText("US$ 24.00", SYMBOLS)).toEqual({ value: 24, currency: "USD", raw: "US$ 24.00" });
  });

  it("handles European decimal commas and ISO codes", () => {
    expect(parsePriceText("24,90 €", SYMBOLS)?.value).toBe(24.9);
    expect(parsePriceText("1.234,56 EUR", SYMBOLS)).toMatchObject({ value: 1234.56, currency: "EUR" });
  });

  it("rejects garbage and non-positive values", () => {
    expect(parsePriceText("call for price", SYMBOLS)).toBeNull();
    expect(parsePriceText(null, SYMBOLS)).toBeNull();
  });
});

describe("parseRatingText", () => {
  it("parses x/5, percentages, and plain ratings with counts", () => {
    expect(parseRatingText("4.6/5 (2,841 reviews)")).toMatchObject({ rating: 4.6, reviewCount: 2841 });
    expect(parseRatingText("90%")).toMatchObject({ rating: 4.5 });
    expect(parseRatingText("4.2")).toMatchObject({ rating: 4.2, reviewCount: null });
  });

  it("rejects out-of-range and empty input", () => {
    expect(parseRatingText("47")).toBeNull();
    expect(parseRatingText("")).toBeNull();
  });
});

describe("fuzzy matching", () => {
  it("scores identical folded strings as 1", () => {
    expect(similarity("Dr. Jart+", "dr jart")).toBe(1);
  });

  it("accepts close matches above threshold and reports near-misses below it", () => {
    const { match } = bestMatch("LANEIGE Seoul", ["LANEIGE"], 0.6);
    expect(match?.value).toBe("LANEIGE");

    const { match: none, nearMiss } = bestMatch("Sulwasoo", ["Sulwhasoo"], 0.95);
    expect(none).toBeNull();
    expect(nearMiss?.value).toBe("Sulwhasoo");
    expect(nearMiss?.score).toBeGreaterThan(0.8);
  });
});

describe("url helpers", () => {
  it("normalizes protocol-relative image urls and strips tracking", () => {
    expect(normalizeImageUrl("https://shop.test/p/1", "//img.test/a.jpg?utm_source=x&w=200")).toBe(
      "https://img.test/a.jpg?w=200",
    );
    expect(stripTracking("https://shop.test/p/1?utm_campaign=abc&color=red#top")).toBe(
      "https://shop.test/p/1?color=red",
    );
  });
});
