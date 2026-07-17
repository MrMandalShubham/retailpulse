import { cleanText } from "../normalize/text.js";
import type { CandidateMap, HtmlExtraction } from "./html.js";

/**
 * Envelope extraction (Phase 1 direct-API raw documents).
 *
 * A raw document may be a verbatim API envelope instead of an HTML page:
 *   { product_id, source, source_url, fetched_at,
 *     endpoints: { "detail-data": {...}, "details-info": {...}, "review-summary": {...} },
 *     http_status: {...} }
 *
 * This extractor maps the envelope's first-party structured fields into the
 * SAME candidate shape the HTML extractor produces, tagged with the
 * 'api_json' method (highest trust weight) — so classification, resolution,
 * normalization, validation and promotion all run unchanged downstream.
 */

export interface RawEnvelopeDoc {
  product_id: string;
  source?: string;
  source_url?: string;
  endpoints: Record<string, unknown>;
}

/** Parse a raw payload as an envelope; null when it isn't one. */
export function tryParseEnvelope(payload: string): RawEnvelopeDoc | null {
  const trimmed = payload.trimStart();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (
      typeof parsed.product_id === "string" &&
      parsed.endpoints !== null &&
      typeof parsed.endpoints === "object"
    ) {
      return parsed as unknown as RawEnvelopeDoc;
    }
    return null;
  } catch {
    return null;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const IMAGE_CDN_BASE = "https://cdn-image.oliveyoung.com/";

function decodeEntities(s: string): string {
  return s
    .replace(/&gt;/gi, ">")
    .replace(/&lt;/gi, "<")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&rsquo;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function add(map: CandidateMap, field: string, value: string | null | undefined): void {
  const cleaned = cleanText(value);
  if (!cleaned) return;
  const list = map.get(field) ?? [];
  list.push({ value: cleaned, method: "api_json" });
  map.set(field, list);
}

/**
 * Split a source category path ("Site &gt; Skincare &gt; Moisturizers &gt; Cream")
 * into { category: first real segment, productType: leaf segment }.
 * The leading segment is the site name and is dropped.
 */
export function splitCategoryPath(raw: string | null | undefined): {
  category: string | null;
  productType: string | null;
} {
  const decoded = cleanText(raw ? decodeEntities(raw) : null);
  if (!decoded) return { category: null, productType: null };
  const segments = decoded
    .split(">")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(1); // drop the site-name root
  if (segments.length === 0) return { category: null, productType: null };
  const category = segments[0] ?? null;
  const leaf = segments[segments.length - 1] ?? null;
  return { category, productType: leaf && leaf !== category ? leaf : null };
}

/** Map an API envelope to extraction candidates + classification signals. */
export function extractFromEnvelope(envelope: RawEnvelopeDoc, url: string): HtmlExtraction {
  const candidates: CandidateMap = new Map();
  const detail = (envelope.endpoints["detail-data"] as any)?.product ?? {};
  const info = (envelope.endpoints["details-info"] as any)?.details ?? {};
  const review = (envelope.endpoints["review-summary"] as any) ?? null;

  // Identity.
  add(candidates, "name", detail.prdtNameEn ?? detail.prdtName);
  add(candidates, "brand", detail.brandName ?? detail.brandNameEn);
  add(candidates, "sku", envelope.product_id); // source's native product number
  add(candidates, "barcode", typeof detail.gdsCd === "string" ? detail.gdsCd : null); // GTIN

  // Category path → category + product type (the source's own taxonomy).
  const { category, productType } = splitCategoryPath(
    detail.allPathCtgrNameEn ?? detail.allPathCtgrName,
  );
  add(candidates, "category", category);
  add(candidates, "product_type", productType);

  // Prices: regular (nrmlAmt) is the list price; sale (saleAmt) is the current
  // promo. Both flow to the fact layer (regular_price / promo_price). The
  // global site quotes USD.
  const regularRaw = detail.nrmlAmt ?? detail.minOptnNrmlAmt;
  const saleRaw = detail.saleAmt ?? detail.minOptnSaleAmt;
  const regular = typeof regularRaw === "number" && regularRaw > 0 ? regularRaw : null;
  const sale = typeof saleRaw === "number" && saleRaw > 0 ? saleRaw : null;
  const amount = regular ?? sale;
  if (amount !== null) {
    add(candidates, "price_text", `USD ${amount}`);
    add(candidates, "currency", "USD");
  }
  if (sale !== null && regular !== null && sale < regular) {
    add(candidates, "promo_price_text", `USD ${sale}`);
  }

  // Rating: formatted so parseRatingText yields { rating, reviewCount }.
  const rate = review?.totalStarRate;
  const count = review?.totalReviewCount;
  if (typeof rate === "number" && rate > 0 && typeof count === "number" && count > 0) {
    add(candidates, "rating_text", `${rate}/5 (${count} reviews)`);
  }

  // Media + description.
  const imagePath = typeof detail.imagePath === "string" ? detail.imagePath : null;
  if (imagePath) {
    add(candidates, "image", imagePath.startsWith("http") ? imagePath : IMAGE_CDN_BASE + imagePath);
  }
  add(
    candidates,
    "description",
    typeof info.whyWeLoveItText === "string" && info.whyWeLoveItText.trim()
      ? decodeEntities(info.whyWeLoveItText)
      : typeof info.sellingPointText === "string" && info.sellingPointText.trim()
        ? decodeEntities(info.sellingPointText)
        : null,
  );

  // Signals: informational only — envelope docs are classified directly as
  // 'product' by the pipeline (an envelope IS a product record by construction).
  return {
    candidates,
    signals: {
      url,
      title: cleanText(detail.prdtNameEn ?? detail.prdtName),
      hasJsonLdProduct: false,
      ogType: null,
      priceTextCount: typeof amount === "number" && amount > 0 ? 1 : 0,
      h1Count: 0,
      productLinkCount: 0,
      totalLinkCount: 0,
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
