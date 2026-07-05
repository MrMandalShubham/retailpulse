import { distance } from "fastest-levenshtein";

/** Fold for identity comparison: lowercase, punctuation to spaces, collapsed. */
export function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** URL-safe slug from any name ("Dr. Jart+ Cream" -> "dr-jart-cream"). */
export function slugify(value: string): string {
  return fold(value).replace(/\s+/g, "-");
}

/**
 * Name similarity in [0, 1]: edit distance combined with a damped token
 * overlap (same behavior as the transform layer's fuzzy matcher, kept local
 * so @dip/promotion has no dependency on worker internals).
 */
export function similarity(a: string, b: string): number {
  const fa = fold(a);
  const fb = fold(b);
  if (fa.length === 0 || fb.length === 0) return 0;
  if (fa === fb) return 1;

  const editSimilarity = 1 - distance(fa, fb) / Math.max(fa.length, fb.length);

  const tokensA = new Set(fa.split(" "));
  const tokensB = new Set(fb.split(" "));
  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) shared += 1;
  }
  const overlap = shared / Math.min(tokensA.size, tokensB.size);

  return Math.max(editSimilarity, 0.75 * overlap);
}
