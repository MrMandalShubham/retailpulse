/**
 * Phase 10 — turn a browser-rendered product record into a standard
 * schema.org Product document. The existing transform layer already extracts
 * name/brand/price/currency/category/image from JSON-LD + product:* meta and
 * uses the JSON-LD Product signal for page-type classification — so a
 * JS-rendered page becomes indistinguishable from a server-rendered one, with
 * ZERO changes downstream.
 */

export interface RenderedProduct {
  /** Site product id (e.g. Olive Young prdtNo) — provenance only. */
  id: string | null;
  /** English product name (from og:title). */
  nameEn: string | null;
  /** Localized name from the dataLayer (fallback if no og:title). */
  nameLocal: string | null;
  /** Readable brand name from the GA4 dataLayer. */
  brand: string | null;
  /** Readable category name from the GA4 dataLayer. */
  category: string | null;
  price: string | null;
  currency: string;
  image: string | null;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "Name | OLIVE YOUNG Global" -> "Name". */
function cleanName(raw: string): string {
  return (raw.split(/\s+\|\s+/)[0] ?? raw).trim();
}

/** Build a minimal HTML doc carrying the product as JSON-LD + product:* meta. */
export function synthesizeProductHtml(url: string, p: RenderedProduct): string {
  const name = cleanName(p.nameEn ?? p.nameLocal ?? "");

  const jsonld: Record<string, unknown> = { "@context": "https://schema.org", "@type": "Product", name };
  if (p.brand) jsonld.brand = { "@type": "Brand", name: p.brand };
  if (p.category) jsonld.category = p.category;
  if (p.image) jsonld.image = p.image;
  if (p.price) {
    jsonld.offers = { "@type": "Offer", price: p.price, priceCurrency: p.currency, url };
  }

  const metas = [
    `<meta property="og:type" content="product"/>`,
    `<meta property="og:title" content="${esc(name)}"/>`,
    p.image ? `<meta property="og:image" content="${esc(p.image)}"/>` : "",
    p.brand ? `<meta property="product:brand" content="${esc(p.brand)}"/>` : "",
    p.price ? `<meta property="product:price:amount" content="${esc(p.price)}"/>` : "",
    p.price ? `<meta property="product:price:currency" content="${esc(p.currency)}"/>` : "",
  ]
    .filter(Boolean)
    .join("\n    ");

  // JSON-LD content is JSON — safe to embed as-is (no </script> can appear in it).
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8"/>
    <title>${esc(name)}</title>
    ${metas}
    <script type="application/ld+json">${JSON.stringify(jsonld)}</script>
  </head>
  <body data-dip-rendered="playwright" data-prdt-no="${esc(p.id ?? "")}">
    <h1>${esc(name)}</h1>
  </body>
</html>`;
}
