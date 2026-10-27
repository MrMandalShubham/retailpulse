/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @cosme product page -> CLEAN typed product row.
 *
 * Two stages, deliberately split so translation (async I/O) stays out of the
 * pure parse:
 *   1. parseCosmeEnvelope  — PURE sync parse of the decoded HTML: JSON-LD
 *      (name/brand/rating/reviews), the "商品情報" info block (price/size/
 *      release), the ranking line (rank + category), and the OG image.
 *   2. assembleCosmeClean  — combine the parse with the JA→EN translations into
 *      the clean row (rating normalized 0–7 → 0–5, brand key synthesized).
 *
 * @cosme is a review aggregator: no stock, no coupon, no sell-status; price is a
 * JPY reference price ("編集部調べ") and is often absent. Ingredients are not
 * listed on the page, so key_ingredients is normally empty.
 */
import { createHash } from "node:crypto";
import type { CosmeEnvelope } from "../ingestion/cosme.js";
import { stripBrandPrefix } from "./oliveyoung-clean.js";

export interface PriceVariant {
  label: string; // e.g. "3g", "1レフィル", "ケース"
  price: number | null; // JPY
}

export interface CosmeParsed {
  productId: string;
  sourceUrl: string;
  fetchedAt: Date | null;
  nameJa: string | null;
  brandNameJa: string | null;
  categoryJa: string | null;
  rankInCategory: number | null;
  ratingRaw: number | null; // native 0–7
  reviewCount: number | null;
  ptScore: number | null;
  price: number | null; // first priced variant (JPY)
  sizeValue: number | null;
  sizeUnit: string | null;
  priceVariants: PriceVariant[];
  primaryImage: string | null;
  releaseDate: string | null; // YYYY-MM-DD
}

export interface CosmeCleanProduct {
  productId: string;
  sourceUrl: string;
  fetchedAt: Date | null;
  nameJa: string | null;
  nameEn: string | null;
  productName: string | null;
  brandNo: string | null;
  brandNameJa: string | null;
  brandNameEn: string | null;
  categoryJa: string | null;
  categoryEn: string | null;
  rankInCategory: number | null;
  ratingRaw: string | null; // numeric column value
  rating: string | null; // normalized 0–5
  ptScore: string | null;
  reviewCount: number | null;
  haveCount: number | null;
  wantCount: number | null;
  price: string | null;
  currency: string;
  sizeValue: string | null;
  sizeUnit: string | null;
  priceVariants: PriceVariant[] | null;
  primaryImage: string | null;
  descriptionJa: string | null;
  descriptionEn: string | null;
  keyIngredients: string[];
  releaseDate: string | null;
  sourceHash: string | null;
}

const stripTags = (s: string): string =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** Collect every schema.org node from the ld+json blocks (handles arrays + @graph). */
function jsonLdNodes(html: string): any[] {
  const nodes: any[] = [];
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const m of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse((m[1] ?? "").trim());
    } catch {
      continue;
    }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of arr) {
      if (node && typeof node === "object") {
        nodes.push(node);
        const graph = (node as any)["@graph"];
        if (Array.isArray(graph)) nodes.push(...graph);
      }
    }
  }
  return nodes;
}

/**
 * label -> value map from the product info list. Some info-ttl rows (クチコミ評価,
 * ランキング) have no info-desc sibling — their values render in another widget —
 * so a naive "adjacent <p>" regex mis-pairs across them. Instead, window each
 * info-ttl up to the NEXT info-ttl and take the first info-desc inside that
 * window; a label with no info-desc in its window is simply skipped.
 */
function infoBlocks(html: string): Map<string, string> {
  const map = new Map<string, string>();
  const ttls = [...html.matchAll(/<p class="info-ttl">([\s\S]*?)<\/p>/g)];
  for (let i = 0; i < ttls.length; i++) {
    const cur = ttls[i];
    if (!cur) continue;
    const label = stripTags(cur[1] ?? "");
    if (!label || map.has(label)) continue;
    const start = (cur.index ?? 0) + cur[0].length;
    const end = ttls[i + 1]?.index ?? html.length;
    const desc = html.slice(start, end).match(/<p class="info-desc">([\s\S]*?)<\/p>/);
    if (desc) map.set(label, stripTags(desc[1] ?? ""));
  }
  return map;
}

function num(v: string | undefined | null): number | null {
  if (!v) return null;
  const n = Number.parseFloat(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** "3g・1,540円 / 1セット・4,180円 (編集部調べ)" -> variants + first price + first size.
 *  Values use fullwidth chars (150ｇ, ３ml) and the katakana middot ・, so NFKC-
 *  normalize first (fullwidth → ASCII) and split on either middot. */
function parsePriceSize(raw: string | undefined): {
  price: number | null;
  sizeValue: number | null;
  sizeUnit: string | null;
  variants: PriceVariant[];
} {
  const empty = { price: null, sizeValue: null, sizeUnit: null, variants: [] as PriceVariant[] };
  if (!raw) return empty;
  // NFKC folds fullwidth latin/digits to ASCII; drop editorial annotations.
  const cleaned = raw
    .normalize("NFKC")
    .replace(/[（(][^）)]*[）)]/g, " ")
    .trim();
  const variants: PriceVariant[] = [];
  for (const seg of cleaned.split("/")) {
    const parts = seg.split(/[・·]/).map((s) => s.trim());
    if (parts.length < 2) continue;
    const label = parts[0] ?? "";
    const priceMatch = (parts[1] ?? "").match(/([\d,]+)\s*円/);
    variants.push({ label, price: priceMatch ? num(priceMatch[1]) : null });
  }
  const firstPriced = variants.find((v) => v.price != null) ?? null;
  let sizeValue: number | null = null;
  let sizeUnit: string | null = null;
  for (const v of variants) {
    const sm = v.label.match(/(\d+(?:\.\d+)?)\s*(g|ml|mg|kg|l|枚|包|本|個|錠)/i);
    if (sm) {
      sizeValue = num(sm[1]);
      sizeUnit = (sm[2] ?? "").toLowerCase();
      break;
    }
  }
  return { price: firstPriced?.price ?? null, sizeValue, sizeUnit, variants };
}

/** "2021/5/1 (…)" -> "2021-05-01". */
function parseReleaseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Pull rank + JA category. @cosme renders this two ways:
 *   A "2位口紅"                    (rank → category), e.g. the ranking info-desc
 *   B "その他洗顔料ランキング 2位"   (category → ランキング → rank), in the meta text
 * Prefer the info-desc value when it carries a category; else scan the page for
 * either format. Category is bounded to Japanese word chars (no ｜ / ☆ / spaces).
 */
const JP = "一-龥ぁ-んァ-ヶー";
function parseRankCategory(
  infoVal: string | undefined,
  html: string,
): { rank: number | null; categoryJa: string | null } {
  const toRank = (s: string | undefined): number | null => {
    const n = num(s);
    return n != null ? Math.trunc(n) : null;
  };
  // Format A from the info-desc value (e.g. "2位口紅").
  if (infoVal) {
    const a = infoVal.match(new RegExp(`(\\d+)\\s*位\\s*([${JP}]{1,15})`));
    if (a) return { rank: toRank(a[1]), categoryJa: a[2] ?? null };
  }
  // Format B anywhere on the page (e.g. "その他洗顔料ランキング 2位").
  const b = html.match(new RegExp(`([${JP}]{2,15}?)ランキング\\s*(\\d+)\\s*位`));
  if (b) return { rank: toRank(b[2]), categoryJa: b[1] ?? null };
  // Format A anywhere on the page.
  const a2 = html.match(new RegExp(`(\\d+)\\s*位\\s*([${JP}]{1,15})`));
  if (a2) return { rank: toRank(a2[1]), categoryJa: a2[2] ?? null };
  return { rank: null, categoryJa: null };
}

function ogImage(html: string): string | null {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (m?.[1] && m[1].startsWith("http")) return m[1];
  // fallback: first product CDN image
  const cdn = html.match(
    /https:\/\/cache-cdn\.cosme\.net\/media\/product\/[^\s"'<>]+\.(?:jpg|png)/i,
  );
  return cdn?.[0] ?? null;
}

/** PURE parse of the decoded @cosme product HTML. null when no JSON-LD Product. */
export function parseCosmeEnvelope(env: CosmeEnvelope): CosmeParsed | null {
  const html = env.html;
  if (!html) return null;

  const product = jsonLdNodes(html).find((n) => n?.["@type"] === "Product");
  if (!product) return null;

  const nameJa = typeof product.name === "string" ? product.name.trim() || null : null;
  const brandNameJa =
    typeof product.brand?.name === "string" ? product.brand.name.trim() || null : null;
  const agg = product.aggregateRating ?? {};
  const ratingRaw = num(agg.ratingValue);
  const reviewCount = num(agg.reviewCount);

  const info = infoBlocks(html);
  const { price, sizeValue, sizeUnit, variants } = parsePriceSize(
    info.get("容量・税込価格") ?? info.get("容量・価格"),
  );
  const releaseDate = parseReleaseDate(info.get("発売日"));
  const { rank, categoryJa } = parseRankCategory(info.get("ランキング"), html);
  const ptMatch = (info.get("クチコミ評価") ?? "").match(/([\d,]+\.?\d*)\s*pt/);

  return {
    productId: env.product_id,
    sourceUrl: env.source_url,
    fetchedAt: env.fetched_at ? new Date(env.fetched_at) : null,
    nameJa,
    brandNameJa,
    categoryJa,
    rankInCategory: rank,
    ratingRaw,
    reviewCount: reviewCount != null ? Math.trunc(reviewCount) : null,
    ptScore: ptMatch ? num(ptMatch[1]) : null,
    price,
    sizeValue,
    sizeUnit,
    priceVariants: variants,
    primaryImage: ogImage(html),
    releaseDate,
  };
}

/** The JA fields that get translated — the translation-cache hash is over these. */
export function cosmeTranslationSource(p: CosmeParsed): Record<string, string> {
  const src: Record<string, string> = {};
  if (p.nameJa) src.name = p.nameJa;
  if (p.brandNameJa) src.brand = p.brandNameJa;
  if (p.categoryJa) src.category = p.categoryJa;
  return src;
}

export function cosmeSourceHash(p: CosmeParsed): string {
  return createHash("md5")
    .update(JSON.stringify(cosmeTranslationSource(p)))
    .digest("hex");
}

function ratingNormalized(raw: number | null): string | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  const v = Math.max(0, Math.min(5, (raw / 7) * 5));
  return v.toFixed(2);
}

/**
 * Combine the pure parse with the JA→EN translations (keys: name/brand/category)
 * into the clean row. Missing translations leave the *_en columns null.
 */
export function assembleCosmeClean(
  p: CosmeParsed,
  translations: Record<string, string>,
  sourceHash: string,
): CosmeCleanProduct {
  const brandNameEn = translations.brand ?? null;
  const nameEn = translations.name ?? null;
  const categoryEn = translations.category ?? null;
  const brandKeySeed = p.brandNameJa ?? brandNameEn;
  const brandNo = brandKeySeed
    ? `jp-${createHash("md5").update(brandKeySeed).digest("hex").slice(0, 16)}`
    : null;

  return {
    productId: p.productId,
    sourceUrl: p.sourceUrl,
    fetchedAt: p.fetchedAt,
    nameJa: p.nameJa,
    nameEn,
    // Core EN name for the serving mirror — strip a leading brand if present.
    productName: stripBrandPrefix(nameEn, brandNameEn),
    brandNo,
    brandNameJa: p.brandNameJa,
    brandNameEn,
    categoryJa: p.categoryJa,
    categoryEn,
    rankInCategory: p.rankInCategory,
    ratingRaw: p.ratingRaw != null ? p.ratingRaw.toFixed(2) : null,
    rating: ratingNormalized(p.ratingRaw),
    ptScore: p.ptScore != null ? p.ptScore.toFixed(1) : null,
    reviewCount: p.reviewCount,
    haveCount: null,
    wantCount: null,
    price: p.price != null ? p.price.toFixed(2) : null,
    currency: "JPY",
    sizeValue: p.sizeValue != null ? p.sizeValue.toFixed(2) : null,
    sizeUnit: p.sizeUnit,
    priceVariants: p.priceVariants.length ? p.priceVariants : null,
    primaryImage: p.primaryImage,
    descriptionJa: null,
    descriptionEn: null,
    keyIngredients: [],
    releaseDate: p.releaseDate,
    sourceHash,
  };
}
