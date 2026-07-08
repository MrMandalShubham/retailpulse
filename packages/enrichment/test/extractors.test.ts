import { describe, expect, it } from "vitest";
import {
  classifyPriceSegment,
  extractDomain,
  extractPa,
  extractSize,
  extractSpf,
  extractTexture,
  type EnrichmentContext,
} from "../src/extractors.js";

const ctx = (over: Partial<EnrichmentContext>): EnrichmentContext => ({
  name: "",
  description: null,
  categoryName: null,
  priceUsd: null,
  brandName: null,
  ...over,
});

describe("SPF / PA extractors", () => {
  it("extracts SPF and PA when present, else needs_source", () => {
    const spf = extractSpf(ctx({ name: "Relief Sun Sunscreen SPF50+ 50ml" }));
    expect(spf).toMatchObject({ found: true, value: "50", method: "regex" });
    expect(extractSpf(ctx({ name: "Hydrating Serum 30ml" }))).toMatchObject({ found: false });

    const pa = extractPa(ctx({ name: "Daily Sunscreen SPF50 PA++++" }));
    expect(pa).toMatchObject({ found: true, value: "PA++++" });
    expect(extractPa(ctx({ name: "Toner 200ml" }))).toMatchObject({ found: false });
  });
});

describe("size extractor", () => {
  it("splits value and unit", () => {
    const s = extractSize(ctx({ name: "Water Bank Cream 50ml" }));
    expect(s.value).toMatchObject({ found: true, value: "50" });
    expect(s.unit).toMatchObject({ found: true, value: "ml" });
  });
  it("handles oz/g and reports absence", () => {
    expect(extractSize(ctx({ name: "Serum 1.7 oz" })).value).toMatchObject({ value: "1.7" });
    expect(extractSize(ctx({ name: "Serum 1.7 oz" })).unit).toMatchObject({ value: "oz" });
    expect(extractSize(ctx({ name: "Mystery Product" })).value).toMatchObject({ found: false });
  });
});

describe("texture & domain", () => {
  it("maps a form keyword to texture", () => {
    expect(extractTexture(ctx({ name: "Advanced Snail Essence 100ml" }))).toMatchObject({
      found: true,
      value: "essence",
    });
    expect(extractTexture(ctx({ name: "Mystery 100ml" }))).toMatchObject({ found: false });
  });
  it("maps category to product domain", () => {
    expect(extractDomain(ctx({ categoryName: "Skincare > Serum" }))).toMatchObject({
      found: true,
      value: "Cosmetics",
    });
    expect(
      extractDomain(ctx({ name: "Whitening Toothpaste", categoryName: "Oral Care" })),
    ).toMatchObject({
      found: true,
      value: "Oral_Care",
    });
    expect(extractDomain(ctx({ categoryName: "Widgets" }))).toMatchObject({ found: false });
  });
});

describe("price segment heuristic (review-gated)", () => {
  it("bands by USD price with modest confidence", () => {
    expect(classifyPriceSegment(ctx({ priceUsd: 92 }))).toMatchObject({
      value: "Luxury",
      method: "rule",
    });
    expect(classifyPriceSegment(ctx({ priceUsd: 50 }))).toMatchObject({ value: "Premium" });
    expect(classifyPriceSegment(ctx({ priceUsd: 21.99 }))).toMatchObject({ value: "Mass_Market" });
    expect(classifyPriceSegment(ctx({ priceUsd: 9 }))).toMatchObject({ value: "Drugstore" });
    const r = classifyPriceSegment(ctx({ priceUsd: 92 }));
    if (r.found) expect(r.confidence).toBeLessThan(0.8); // heuristic → not auto-applied
    expect(classifyPriceSegment(ctx({ priceUsd: null }))).toMatchObject({ found: false });
  });
});
