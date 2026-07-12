import { describe, expect, it } from "vitest";
import { discoverViaSitemap } from "../src/discovery/sitemap.js";

const logger = { info() {}, warn() {} };

/** Mock fetchText that serves a robots.txt → sitemap index → child urlset. */
function makeFetch(pages: Record<string, string>): (url: string) => Promise<string | null> {
  return async (url: string) => pages[url] ?? null;
}

const ROBOTS = `User-agent: *\nAllow: /\nSitemap: https://shop.test/sitemap.xml`;
const INDEX = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://shop.test/sm-products.xml</loc></sitemap><sitemap><loc>https://shop.test/sm-pages.xml</loc></sitemap></sitemapindex>`;
const PRODUCTS = `<?xml version="1.0"?><urlset>
  <url><loc>https://shop.test/product/detail?prdtNo=A1</loc></url>
  <url><loc>https://shop.test/product/detail?prdtNo=A2</loc></url>
  <url><loc>https://shop.test/about</loc></url>
</urlset>`;
const PAGES = `<?xml version="1.0"?><urlset><url><loc>https://shop.test/help</loc></url></urlset>`;

describe("discoverViaSitemap", () => {
  it("recurses the sitemap index and filters to product URLs via regex", async () => {
    const fetchText = makeFetch({
      "https://shop.test/robots.txt": ROBOTS,
      "https://shop.test/sitemap.xml": INDEX,
      "https://shop.test/sm-products.xml": PRODUCTS,
      "https://shop.test/sm-pages.xml": PAGES,
    });
    const urls = await discoverViaSitemap(
      "https://shop.test/",
      { strategy: "sitemap", productUrlRegex: "/product/detail\\?prdtNo=" },
      { fetchText, logger },
    );
    const found = urls.map((u) => u.url).sort();
    expect(found).toEqual([
      "https://shop.test/product/detail?prdtNo=A1",
      "https://shop.test/product/detail?prdtNo=A2",
    ]);
    expect(urls.every((u) => u.isProduct)).toBe(true);
  });

  it("uses an explicit sitemapUrl and marks non-filtered URLs as candidates", async () => {
    const fetchText = makeFetch({ "https://shop.test/sm-products.xml": PRODUCTS });
    const urls = await discoverViaSitemap(
      "https://shop.test/",
      { strategy: "sitemap", sitemapUrl: "https://shop.test/sm-products.xml" },
      { fetchText, logger },
    );
    // No regex → every <loc> kept as a candidate (not confirmed).
    expect(urls).toHaveLength(3);
    expect(urls.every((u) => u.isProduct)).toBe(false);
  });

  it("returns nothing when no sitemap is reachable", async () => {
    const urls = await discoverViaSitemap(
      "https://shop.test/",
      { strategy: "sitemap" },
      { fetchText: makeFetch({}), logger },
    );
    expect(urls).toEqual([]);
  });
});
