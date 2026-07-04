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
  const countMatch = raw.match(/\(?\s*([\d,]{2,})\s*\)?\s*(?:reviews?|ratings?)?/i);
  if (countMatch?.[1]) {
    const count = Number.parseInt(countMatch[1].replace(/,/g, ""), 10);
    // Avoid mistaking the rating itself for a count.
    if (Number.isInteger(count) && count > 5) reviewCount = count;
  }

  return { rating: Math.round(rating * 100) / 100, reviewCount, raw };
}
