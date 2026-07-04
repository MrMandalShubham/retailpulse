import * as cheerio from "cheerio";
import type { ExtractionMethod } from "@dip/domain";
import { cleanText } from "../normalize/text.js";
import { normalizeImageUrl } from "../normalize/urls.js";
import type { RuleEngine } from "../normalize/rule-engine.js";
import { extractJsonLdProducts } from "./jsonld.js";

export interface FieldCandidate {
  value: string;
  method: ExtractionMethod;
}

/** field name -> candidates from every extraction method that produced one. */
export type CandidateMap = Map<string, FieldCandidate[]>;

/** Signals feeding the page-type classifier. */
export interface PageSignals {
  url: string;
  title: string | null;
  hasJsonLdProduct: boolean;
  ogType: string | null;
  priceTextCount: number;
  h1Count: number;
  productLinkCount: number;
  totalLinkCount: number;
}

export interface HtmlExtraction {
  candidates: CandidateMap;
  signals: PageSignals;
}

const PRICE_TEXT_PATTERN = /(?:₩|\$|€|£|USD|KRW|EUR|GBP)\s?\d[\d,.]*/g;
const PRODUCT_PATH_HINTS = ["/product", "/goods", "/item", "/prd", "/detail"];

function addCandidate(
  map: CandidateMap,
  field: string,
  value: string | null | undefined,
  method: ExtractionMethod,
): void {
  const cleaned = cleanText(value);
  if (!cleaned) return;
  const list = map.get(field) ?? [];
  list.push({ value: cleaned, method });
  map.set(field, list);
}

/**
 * Deterministic extraction pass: title, meta, OpenGraph, JSON-LD, cheap DOM
 * heuristics, rule-driven selector hints and regex patterns. Produces
 * candidates per field (never a single "truth") — scoring happens later.
 */
export function extractFromHtml(html: string, url: string, rules: RuleEngine): HtmlExtraction {
  const $ = cheerio.load(html);
  const candidates: CandidateMap = new Map();

  // <title> and standard meta tags.
  const title = cleanText($("title").first().text());
  addCandidate(candidates, "name", stripSiteSuffix(title), "meta_tags");
  addCandidate(candidates, "description", $('meta[name="description"]').attr("content"), "meta_tags");

  // OpenGraph.
  addCandidate(candidates, "name", $('meta[property="og:title"]').attr("content"), "opengraph");
  addCandidate(candidates, "description", $('meta[property="og:description"]').attr("content"), "opengraph");
  const ogImage = normalizeImageUrl(url, $('meta[property="og:image"]').attr("content"));
  addCandidate(candidates, "image", ogImage, "opengraph");
  addCandidate(candidates, "brand", $('meta[property="product:brand"]').attr("content"), "opengraph");
  addCandidate(candidates, "price_text", $('meta[property="product:price:amount"]').attr("content"), "opengraph");
  addCandidate(candidates, "currency", $('meta[property="product:price:currency"]').attr("content"), "opengraph");
  const ogType = cleanText($('meta[property="og:type"]').attr("content"));

  // JSON-LD (schema.org Product).
  const jsonLdProducts = extractJsonLdProducts($);
  for (const product of jsonLdProducts) {
    addCandidate(candidates, "name", product.name, "jsonld");
    addCandidate(candidates, "brand", product.brand, "jsonld");
    addCandidate(candidates, "description", product.description, "jsonld");
    addCandidate(candidates, "category", product.category, "jsonld");
    addCandidate(candidates, "image", normalizeImageUrl(url, product.image), "jsonld");
    addCandidate(candidates, "price_text", product.priceText, "jsonld");
    addCandidate(candidates, "currency", product.currency, "jsonld");
    addCandidate(candidates, "rating_text", product.ratingText, "jsonld");
  }

  // DOM heuristics.
  addCandidate(candidates, "name", $("h1").first().text(), "dom_heuristic");
  const priceish = $('[class*="price" i], [id*="price" i]').first().text();
  addCandidate(candidates, "price_text", firstPriceMatch(priceish), "dom_heuristic");

  // Rule-driven, source-specific extraction (learned knowledge).
  for (const hint of rules.selectorHints()) {
    addCandidate(candidates, hint.field, $(hint.selector).first().text(), "rule_inferred");
  }
  const bodyText = $("body").text();
  for (const regexRule of rules.regexRules()) {
    const match = bodyText.match(regexRule.pattern);
    addCandidate(candidates, regexRule.field, match?.[1] ?? match?.[0] ?? null, "rule_inferred");
  }

  // URL hints (weak but useful signals).
  const pathName = safePathname(url);
  if (PRODUCT_PATH_HINTS.some((hint) => pathName.includes(hint))) {
    const slugWords = cleanText(decodeURIComponent(pathName.split("/").pop() ?? "").replace(/[-_]+/g, " "));
    addCandidate(candidates, "name", slugWords, "url_hint");
  }

  // Signals for classification.
  const bodyTextSample = bodyText.slice(0, 200_000);
  const links = $("a[href]");
  const productLinkCount = links.filter((_, el) => {
    const href = ($(el).attr("href") ?? "").toLowerCase();
    return PRODUCT_PATH_HINTS.some((hint) => href.includes(hint));
  }).length;

  return {
    candidates,
    signals: {
      url,
      title,
      hasJsonLdProduct: jsonLdProducts.length > 0,
      ogType,
      priceTextCount: (bodyTextSample.match(PRICE_TEXT_PATTERN) ?? []).length,
      h1Count: $("h1").length,
      productLinkCount,
      totalLinkCount: links.length,
    },
  };
}

/** "Product Name | Store" / "Product Name - Store" -> "Product Name". */
function stripSiteSuffix(title: string | null): string | null {
  if (!title) return null;
  const parts = title.split(/\s+[|\-–]\s+/);
  return parts.length > 1 && (parts[0]?.length ?? 0) >= 8 ? (parts[0] ?? title) : title;
}

function firstPriceMatch(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(PRICE_TEXT_PATTERN);
  return match?.[0] ?? null;
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}
