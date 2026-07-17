import { cleanText } from "./text.js";

export interface ParsedRating {
  /** Normalized to a 0–5 scale. */
  rating: number;
  reviewCount: number | null;
  raw: string;
}

/**
 * Parse rating text like "4.5", "4.5/5", "4.5 out of 5", "90%" (→ 4.5),
 * optionally with a review count ("(1,234)", "1234 reviews").
 */
export function parseRatingText(rawInput: string | null | undefined): ParsedRating | null {
  const raw = cleanText(rawInput);
  if (!raw) return null;

  let rating: number | null = null;

  const outOf = raw.match(/(\d+(?:\.\d+)?)\s*(?:\/|out of)\s*(\d+(?:\.\d+)?)/i);
  const percent = raw.match(/(\d+(?:\.\d+)?)\s*%/);
  const plain = raw.match(/\d+(?:\.\d+)?/);

  if (outOf?.[1] && outOf[2]) {
    const value = Number.parseFloat(outOf[1]);
    const scale = Number.parseFloat(outOf[2]);
    if (scale > 0) rating = (value / scale) * 5;
  } else if (percent?.[1]) {
    rating = (Number.parseFloat(percent[1]) / 100) * 5;
  } else if (plain?.[0]) {
    const value = Number.parseFloat(plain[0]);
    if (value >= 0 && value <= 5) rating = value;
  }

  if (rating === null || !Number.isFinite(rating) || rating < 0 || rating > 5) return null;

  let reviewCount: number | null = null;
  // An explicit "N reviews/ratings" label is unambiguous — accept any N ≥ 1.
  const labeled = raw.match(/([\d,]+)\s*(?:reviews?|ratings?)\b/i);
  // A bare number is only trusted above 5 (else it could be the rating itself).
  const bare = raw.match(/\(?\s*([\d,]{2,})\s*\)?/);
  if (labeled?.[1]) {
    const count = Number.parseInt(labeled[1].replace(/,/g, ""), 10);
    if (Number.isInteger(count) && count >= 1) reviewCount = count;
  } else if (bare?.[1]) {
    const count = Number.parseInt(bare[1].replace(/,/g, ""), 10);
    if (Number.isInteger(count) && count > 5) reviewCount = count;
  }

  return { rating: Math.round(rating * 100) / 100, reviewCount, raw };
}
