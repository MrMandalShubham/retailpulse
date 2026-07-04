import type * as cheerio from "cheerio";

export interface JsonLdProduct {
  name: string | null;
  brand: string | null;
  description: string | null;
  category: string | null;
  image: string | null;
  priceText: string | null;
  currency: string | null;
  ratingText: string | null;
}

/**
 * Walk every <script type="application/ld+json"> block and collect
 * schema.org Product nodes (handles arrays and @graph containers).
 * Malformed JSON is skipped silently — raw pages are hostile territory.
 */
export function extractJsonLdProducts($: cheerio.CheerioAPI): JsonLdProduct[] {
  const products: JsonLdProduct[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const rawJson = $(el).text();
    if (!rawJson?.trim()) return;
    try {
      const parsed: unknown = JSON.parse(rawJson);
      for (const node of flattenNodes(parsed)) {
        if (isProductNode(node)) {
          products.push(toProduct(node));
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  });
  return products;
}

type JsonNode = Record<string, unknown>;

function flattenNodes(parsed: unknown): JsonNode[] {
  if (Array.isArray(parsed)) {
    return parsed.flatMap(flattenNodes);
  }
  if (typeof parsed === "object" && parsed !== null) {
    const node = parsed as JsonNode;
    const graph = node["@graph"];
    return Array.isArray(graph) ? [node, ...graph.flatMap(flattenNodes)] : [node];
  }
  return [];
}

function isProductNode(node: JsonNode): boolean {
  const type = node["@type"];
  if (typeof type === "string") return type.toLowerCase() === "product";
  if (Array.isArray(type)) {
    return type.some((t) => typeof t === "string" && t.toLowerCase() === "product");
  }
  return false;
}

function toProduct(node: JsonNode): JsonLdProduct {
  const offers = firstObject(node.offers);
  const rating = firstObject(node.aggregateRating);
  const price = offers?.price ?? offers?.lowPrice ?? null;
  const ratingValue = rating?.ratingValue ?? null;
  const reviewCount = rating?.reviewCount ?? rating?.ratingCount ?? null;

  return {
    name: asString(node.name),
    brand: asString(node.brand) ?? asString(firstObject(node.brand)?.name),
    description: asString(node.description),
    category: asString(node.category),
    image: asString(node.image) ?? asString(firstItem(node.image)),
    priceText: price !== null ? String(price) : null,
    currency: asString(offers?.priceCurrency),
    ratingText:
      ratingValue !== null
        ? `${String(ratingValue)}/5${reviewCount !== null ? ` (${String(reviewCount)} reviews)` : ""}`
        : null,
  };
}

function firstObject(value: unknown): JsonNode | null {
  const item = Array.isArray(value) ? value[0] : value;
  return typeof item === "object" && item !== null ? (item as JsonNode) : null;
}

function firstItem(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
