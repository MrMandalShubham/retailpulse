import { describe, expect, it } from "vitest";
import { normalizeSourceUrl } from "../src/url.js";

describe("normalizeSourceUrl", () => {
  it("lowercases host, drops fragments and default ports", () => {
    expect(normalizeSourceUrl("HTTPS://Shop.Test:443/Product/Abc#reviews")).toBe(
      "https://shop.test/Product/Abc",
    );
    expect(normalizeSourceUrl("http://shop.test:80/a")).toBe("http://shop.test/a");
  });

  it("strips tracking params but keeps meaningful ones, sorted", () => {
    expect(
      normalizeSourceUrl("https://shop.test/p?utm_source=x&color=red&fbclid=1&size=m&ref=nav"),
    ).toBe("https://shop.test/p?color=red&size=m");
    expect(normalizeSourceUrl("https://shop.test/p?b=2&a=1")).toBe(
      normalizeSourceUrl("https://shop.test/p?a=1&b=2"),
    );
  });

  it("trims trailing slashes except at the root", () => {
    expect(normalizeSourceUrl("https://shop.test/product/abc/")).toBe(
      "https://shop.test/product/abc",
    );
    expect(normalizeSourceUrl("https://shop.test/")).toBe("https://shop.test/");
  });

  it("maps equivalent URL spellings to one canonical form", () => {
    const canonical = normalizeSourceUrl("https://shop.test/product/abc");
    for (const variant of [
      "https://SHOP.test/product/abc/",
      "https://shop.test:443/product/abc?utm_campaign=x",
      "https://shop.test/product/abc#top",
    ]) {
      expect(normalizeSourceUrl(variant)).toBe(canonical);
    }
  });

  it("returns trimmed input for unparseable strings", () => {
    expect(normalizeSourceUrl("  not-a-url  ")).toBe("not-a-url");
  });
});
