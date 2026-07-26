/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Olive Young raw envelope -> CLEAN typed product row.
 *
 * Pure transform (no I/O): decode HTML entities, parse numbers, Y/N -> boolean,
 * YYYYMMDD -> date, split the category path into levels, trim/normalize text.
 * No raw or half-parsed value reaches the clean store.
 */

const CDN = "https://cdn-image.oliveyoung.com/";

export interface CleanProduct {
  productId: string;
  barcode: string | null;
  sourceUrl: string;
  rawDocumentId: string | null;
  fetchedAt: Date | null;
  nameEn: string | null;
  nameKr: string | null;
  productName: string | null;
  sizeValue: string | null;
  sizeUnit: string | null;
  setType: string | null;
  composition: string | null;
  brandNo: string | null;
  brandName: string | null;
  brandNameKr: string | null;
  categoryNo: string | null;
  categoryPathEn: string | null;
  categoryPathKr: string | null;
  categoryL1: string | null;
  categoryL2: string | null;
  categoryL3: string | null;
  regularPrice: string | null;
  salePrice: string | null;
  discountRate: string | null;
  currency: string;
  minCouponPrice: string | null;
  stockQty: number | null;
  sellStatusCode: string | null;
  isBest: boolean | null;
  isNew: boolean | null;
  isFlash: boolean | null;
  isSellingFast: boolean | null;
  releaseDate: string | null;
  descriptionHtml: string | null;
  sellingPoint: string | null;
  whyWeLoveIt: string | null;
  ingredients: string | null;
  howToUse: string | null;
  primaryImage: string | null;
  reviewCount: number | null;
  avgRating: string | null;
  mediaReviewCount: number | null;
  options: unknown;
  thumbnails: unknown;
  promotion: unknown;
  memberPricing: unknown;
  starBreakdown: unknown;
  attributeScores: unknown;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&reg;/gi, "®")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&"); // last, so decoded entities aren't re-decoded
}

/** Short single-line field: decode, collapse all whitespace, trim. */
function clean(v: unknown): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v !== "string") return null;
  const t = decodeEntities(v).replace(/\s+/g, " ").trim();
  return t.length ? t : null;
}

/** Prose field: decode, normalize newlines, collapse spaces within lines, trim. */
function cleanProse(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = decodeEntities(v)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.length ? t : null;
}

/** HTML content: decode entities, trim — keep the markup itself. */
function decodeHtml(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = decodeEntities(v).trim();
  return t.length ? t : null;
}

/** Numeric column value (string, 2dp) or null. */
function num(v: unknown): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

/** Rating clamped to the valid 0–5 range (else null). */
function ratingNum(v: unknown): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n.toFixed(2) : null;
}

function intVal(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function yn(v: unknown): boolean | null {
  return v === "Y" ? true : v === "N" ? false : null;
}

/** "YYYYMMDD" -> "YYYY-MM-DD" (else null). */
function ymd(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{8}$/.test(v)) return null;
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

/** Split "Site > A > B > C" -> [A, B, C] (site root dropped). */
function splitPath(pathEn: string | null): [string | null, string | null, string | null] {
  if (!pathEn) return [null, null, null];
  const segs = pathEn
    .split(">")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(1);
  return [segs[0] ?? null, segs[1] ?? null, segs[2] ?? null];
}

function imageUrl(imagePath: unknown): string | null {
  if (typeof imagePath !== "string" || !imagePath) return null;
  return imagePath.startsWith("http") ? imagePath : CDN + imagePath;
}

/** Representative option's live stock (else first option, else null). */
function repStock(optionList: unknown): number | null {
  if (!Array.isArray(optionList) || optionList.length === 0) return null;
  const rep = optionList.find((o: any) => o?.rprstYn === "Y") ?? optionList[0];
  return intVal(rep?.buyStockQty);
}

export interface NameParts {
  productName: string | null;
  sizeValue: string | null; // numeric column value
  sizeUnit: string | null;
  setType: string | null;
  composition: string | null;
}

const EDITION_RE = /^\s*\[[^\]]*\]\s*/;
// A gift/bonus parenthetical: starts with '+', or contains the word "gift"
// anywhere (e.g. "(50ml+50ml+15ml Gift)", "(Free Gift: Toner 100ml)").
const GIFT_RE = /\(\s*(\+[^)]*|[^)]*\bgift\b[^)]*)\)/i;
const SIZE_RE = /(\d+(?:\.\d+)?)\s?(ml|g|kg|ea|pcs|sheets?|매|팩|정|캡슐|장)\b/i;
const SIZE_RE_G = new RegExp(SIZE_RE.source, "gi");
const SET_RE = /\s+((?:special|double|refill|gift|value|jumbo|duo|mini|travel|limited)\s+)*(set|pack|duo|kit)\s*$/i;

/**
 * Split a raw Olive Young product name into parts (heuristic; name_en stays the
 * fallback). Keeps the brand IN product_name; strips the [edition] prefix, the
 * size token(s), a trailing set descriptor, and the (+gift) parenthetical.
 *   "celimax Retinal Shot 15ml Set (+3ml)"
 *     -> productName "celimax Retinal Shot", size 15 ml, setType "Set", composition "+3ml"
 */
export function parseNameParts(nameEnRaw: string | null): NameParts {
  const empty: NameParts = {
    productName: null,
    sizeValue: null,
    sizeUnit: null,
    setType: null,
    composition: null,
  };
  if (!nameEnRaw) return empty;
  let work = nameEnRaw.replace(EDITION_RE, "");

  // gift / composition parenthetical
  let composition: string | null = null;
  const gift = work.match(GIFT_RE);
  if (gift?.[1]) {
    composition = gift[1].trim().replace(/\s+/g, " ");
    work = work.replace(gift[0], " ");
  }

  // size: first value+unit for the columns, then remove ALL size tokens from the name
  let sizeValue: string | null = null;
  let sizeUnit: string | null = null;
  const size = work.match(SIZE_RE);
  if (size?.[1] && size[2]) {
    sizeValue = Number.parseFloat(size[1]).toFixed(2);
    sizeUnit = size[2].toLowerCase();
    work = work.replace(SIZE_RE_G, " ");
  }

  // trailing set descriptor
  let setType: string | null = null;
  const set = work.match(SET_RE);
  if (set && set.index !== undefined) {
    setType = set[0]
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    work = work.slice(0, set.index);
  }

  const productName =
    work
      // orphan '+' left by a removed second size (e.g. "30ml+30ml" -> " + ");
      // only when space-bounded, so real names like "No.5+" survive.
      .replace(/\s+\+\s+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[\s:,\-–+]+$/, "") // trailing junk incl. an orphan '+'
      .trim() || null;
  return { productName, sizeValue, sizeUnit, setType, composition };
}

/**
 * Map one raw envelope to a clean product row. Returns null when the essential
 * detail-data is missing (delisted/failed fetches) — those never enter the
 * clean store.
 */
export function mapEnvelopeToCleanProduct(env: any, rawDocumentId: string | null): CleanProduct | null {
  const d = env?.endpoints?.["detail-data"]?.product;
  if (!d || typeof d !== "object") return null;
  const info = env?.endpoints?.["details-info"]?.details ?? {};
  const r = env?.endpoints?.["review-summary"] ?? {};

  const productId = clean(env?.product_id) ?? clean(d.prdtNo);
  if (!productId) return null;

  const pathEn = clean(d.allPathCtgrNameEn);
  const [l1, l2, l3] = splitPath(pathEn);
  const nameEn = clean(d.prdtNameEn);
  const parts = parseNameParts(nameEn);

  return {
    productId,
    barcode: clean(d.gdsCd),
    sourceUrl: typeof env?.source_url === "string" ? env.source_url : "",
    rawDocumentId,
    fetchedAt: env?.fetched_at ? new Date(env.fetched_at) : null,
    nameEn,
    nameKr: clean(d.korPrdtName ?? d.prdtName),
    productName: parts.productName,
    sizeValue: parts.sizeValue,
    sizeUnit: parts.sizeUnit,
    setType: parts.setType,
    composition: parts.composition,
    brandNo: clean(d.brandNo),
    brandName: clean(d.brandName ?? d.brandNameEn),
    brandNameKr: clean(d.korBrandName),
    categoryNo: clean(d.ctgrNo),
    categoryPathEn: pathEn,
    categoryPathKr: clean(d.korAllPathCtgrName),
    categoryL1: l1,
    categoryL2: l2,
    categoryL3: l3,
    regularPrice: num(d.nrmlAmt),
    salePrice: num(d.saleAmt),
    discountRate: num(d.discountRate),
    currency: "USD",
    minCouponPrice: num(d.minCpnApplyAmt),
    stockQty: repStock(d.optionList),
    sellStatusCode: clean(d.sellStatCode),
    isBest: yn(d.bestYn),
    isNew: yn(d.newYn),
    isFlash: yn(d.flashYn),
    isSellingFast: yn(d.sellingFastYn),
    releaseDate: ymd(d.releaseYmd),
    descriptionHtml: decodeHtml(info.dtlDesc),
    sellingPoint: cleanProse(info.sellingPointText),
    whyWeLoveIt: cleanProse(info.whyWeLoveItText),
    ingredients: cleanProse(info.ftrdIngrdText),
    howToUse: cleanProse(info.howToUseText),
    primaryImage: imageUrl(d.imagePath),
    reviewCount: intVal(r.totalReviewCount),
    avgRating: ratingNum(r.totalStarRate),
    mediaReviewCount: intVal(r.totalMediaReviewCount),
    options: d.optionList ?? null,
    thumbnails: d.thumbnailList ?? null,
    promotion: d.promotion ?? null,
    memberPricing: d.mbrGradeCpnMap ?? null,
    starBreakdown: r.scores ?? null,
    attributeScores: r.evltScores ?? null,
  };
}
