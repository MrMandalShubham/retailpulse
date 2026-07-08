import type { PRICE_SEGMENTS, PRODUCT_DOMAINS, ExtractionOutcome } from "@dip/domain";

/**
 * Deterministic + heuristic extractors (pure functions). Each returns a
 * GROUNDED value with evidence, or { found:false, reason } — never a guess.
 */

export interface EnrichmentContext {
  name: string;
  description: string | null;
  categoryName: string | null;
  priceUsd: number | null;
  brandName: string | null;
}

const text = (ctx: EnrichmentContext): string =>
  [ctx.name, ctx.description].filter(Boolean).join(" · ");

/** SPF — literal "SPF50" / "SPF 50+" in the text. */
export function extractSpf(ctx: EnrichmentContext): ExtractionOutcome {
  const m = text(ctx).match(/SPF\s?(\d{1,2})\+?/i);
  if (!m) return { found: false, reason: "no SPF token in name/description" };
  return {
    found: true,
    value: m[1] as string,
    confidence: 0.98,
    method: "regex",
    evidence: m[0],
  };
}

/** PA rating — literal "PA+", "PA++++". */
export function extractPa(ctx: EnrichmentContext): ExtractionOutcome {
  const m = text(ctx).match(/\bPA(\+{1,4})/i);
  if (!m) return { found: false, reason: "no PA rating token in name/description" };
  return { found: true, value: `PA${m[1]}`, confidence: 0.98, method: "regex", evidence: m[0] };
}

/** Size / volume — "100ml", "1.7 oz", "50 g". Returns value + unit together. */
export function extractSize(ctx: EnrichmentContext): {
  value: ExtractionOutcome;
  unit: ExtractionOutcome;
} {
  const m = text(ctx).match(/(\d+(?:\.\d+)?)\s?(ml|g|oz|kg|l)\b/i);
  if (!m) {
    const reason = "no size/volume token in name/description";
    return { value: { found: false, reason }, unit: { found: false, reason } };
  }
  const unit = (m[2] as string).toLowerCase();
  return {
    value: {
      found: true,
      value: m[1] as string,
      confidence: 0.95,
      method: "regex",
      evidence: m[0],
    },
    unit: { found: true, value: unit, confidence: 0.95, method: "regex", evidence: m[0] },
  };
}

const TEXTURE_KEYWORDS: Array<[RegExp, string]> = [
  [/\bserum\b/i, "serum"],
  [/\bessence\b/i, "essence"],
  [/\bampoule\b/i, "ampoule"],
  [/\bcream\b/i, "cream"],
  [/\bgel\b/i, "gel"],
  [/\bl?otion\b/i, "lotion"],
  [/\btoner\b/i, "toner"],
  [/\boil\b/i, "oil"],
  [/\bbalm\b/i, "balm"],
  [/\bfoam\b/i, "foam"],
  [/\bmist\b/i, "mist"],
  [/\bmask\b/i, "mask"],
  [/\bcleanser\b/i, "cleanser"],
  [/\bbutter\b/i, "butter"],
  [/\bstick\b/i, "stick"],
  [/\bsunscreen\b/i, "sunscreen"],
];

/** Texture / form — keyword rule on the product name. */
export function extractTexture(ctx: EnrichmentContext): ExtractionOutcome {
  for (const [re, label] of TEXTURE_KEYWORDS) {
    const m = ctx.name.match(re);
    if (m) return { found: true, value: label, confidence: 0.8, method: "rule", evidence: m[0] };
  }
  return { found: false, reason: "no recognizable texture/form keyword in name" };
}

/** Product domain — deterministic mapping from the category/name. */
export function extractDomain(ctx: EnrichmentContext): ExtractionOutcome {
  const hay = [ctx.categoryName, ctx.name].filter(Boolean).join(" ").toLowerCase();
  const map: Array<[RegExp, (typeof PRODUCT_DOMAINS)[number]]> = [
    [/oral|tooth|dental|mouth/, "Oral_Care"],
    [/supplement|collagen drink|nutri|ingestible/, "Nutri_Cosmetics"],
    [
      /skincare|skin|serum|essence|toner|cream|ampoule|cleanser|sunscreen|makeup|cosmetic|beauty/,
      "Cosmetics",
    ],
  ];
  for (const [re, domain] of map) {
    if (re.test(hay))
      return {
        found: true,
        value: domain,
        confidence: 0.9,
        method: "rule",
        evidence: `category/name matched ${re}`,
      };
  }
  return { found: false, reason: "could not map category/name to a product domain" };
}

/**
 * Price segment — heuristic band from USD benchmark. REVIEW-GATED (proposed):
 * price alone is fuzzy, so a human confirms before it reaches published data.
 */
export function classifyPriceSegment(ctx: EnrichmentContext): ExtractionOutcome {
  if (ctx.priceUsd == null)
    return { found: false, reason: "no USD price benchmark to classify from" };
  const p = ctx.priceUsd;
  let seg: (typeof PRICE_SEGMENTS)[number];
  if (p >= 80) seg = "Luxury";
  else if (p >= 40) seg = "Premium";
  else if (p >= 15) seg = "Mass_Market";
  else seg = "Drugstore";
  return {
    found: true,
    value: seg,
    confidence: 0.65,
    method: "rule",
    evidence: `USD ${p.toFixed(2)} price band`,
  };
}
