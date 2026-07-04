import type { PageType } from "@dip/domain";
import type { PageSignals } from "../extract/html.js";

export interface PageClassification {
  pageType: PageType;
  /** Main reason for the classification — stored on staged_products.dominant_signal. */
  dominantSignal: string;
  score: number;
}

/**
 * Cheap local page-type classifier. Additive signal scoring per type; the
 * strongest contributing signal becomes dominant_signal so operators (and
 * future AI review) can see WHY a page was classified.
 */
export function classifyPageType(signals: PageSignals): PageClassification {
  const scores: Record<Exclude<PageType, "unknown">, { score: number; signals: Array<[string, number]> }> = {
    product: { score: 0, signals: [] },
    listing: { score: 0, signals: [] },
    non_product: { score: 0, signals: [] },
  };
  const add = (type: Exclude<PageType, "unknown">, signal: string, weight: number) => {
    scores[type].score += weight;
    scores[type].signals.push([signal, weight]);
  };

  const path = safePathname(signals.url);

  if (signals.hasJsonLdProduct) add("product", "jsonld_product", 0.6);
  if (signals.ogType?.toLowerCase().includes("product")) add("product", "og_type_product", 0.3);
  if (/\/(product|goods|item|prd|detail)/.test(path)) add("product", "product_url_path", 0.25);
  if (signals.priceTextCount >= 1 && signals.priceTextCount <= 4 && signals.h1Count >= 1) {
    add("product", "single_price_with_heading", 0.2);
  }

  if (/\/(category|categories|display|collection|list|search|shop)/.test(path)) {
    add("listing", "listing_url_path", 0.35);
  }
  if (signals.productLinkCount >= 10 && !signals.hasJsonLdProduct) {
    add("listing", "product_link_grid", 0.45);
  }
  if (signals.priceTextCount >= 8 && !signals.hasJsonLdProduct) {
    add("listing", "many_price_snippets", 0.25);
  }

  if (path === "/" || path === "") add("non_product", "root_homepage", 0.4);
  if (signals.totalLinkCount > 150 && signals.productLinkCount < 5 && !signals.hasJsonLdProduct) {
    add("non_product", "link_heavy_no_product_evidence", 0.25);
  }
  if (signals.priceTextCount === 0 && !signals.hasJsonLdProduct && !signals.ogType?.includes("product")) {
    add("non_product", "no_price_or_product_markup", 0.25);
  }
  if (signals.productLinkCount === 0 && signals.priceTextCount === 0 && !signals.hasJsonLdProduct) {
    add("non_product", "no_product_evidence_at_all", 0.15);
  }

  // Homepages that are really storefront listing grids: listing evidence wins over root path.
  let best: { type: PageType; score: number; signals: Array<[string, number]> } = {
    type: "unknown",
    score: 0,
    signals: [],
  };
  for (const [type, entry] of Object.entries(scores) as Array<
    [Exclude<PageType, "unknown">, (typeof scores)["product"]]
  >) {
    if (entry.score > best.score) best = { type, score: entry.score, signals: entry.signals };
  }

  if (best.score < 0.35) {
    return { pageType: "unknown", dominantSignal: "insufficient_signals", score: best.score };
  }
  const dominant = best.signals.sort((a, b) => b[1] - a[1])[0];
  return { pageType: best.type, dominantSignal: dominant?.[0] ?? "unscored", score: best.score };
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase().replace(/\/+$/, "") || "/";
  } catch {
    return "";
  }
}
