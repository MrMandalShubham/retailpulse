import { distance } from "fastest-levenshtein";
import { FUZZY_MATCH_THRESHOLD } from "@dip/domain";
import { fold } from "./text.js";

/**
 * Normalized similarity in [0, 1] over folded strings. Combines edit distance
 * with a damped token-overlap coefficient so "cosrx" vs "COSRX Official"
 * scores as a suggestable near-miss (0.75) rather than a poor match, without
 * being strong enough to auto-accept.
 */
export function similarity(a: string, b: string): number {
  const fa = fold(a);
  const fb = fold(b);
  if (fa.length === 0 || fb.length === 0) return 0;
  if (fa === fb) return 1;

  const maxLen = Math.max(fa.length, fb.length);
  const editSimilarity = 1 - distance(fa, fb) / maxLen;

  const tokensA = new Set(fa.split(" "));
  const tokensB = new Set(fb.split(" "));
  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) shared += 1;
  }
  const overlapCoefficient = shared / Math.min(tokensA.size, tokensB.size);

  return Math.max(editSimilarity, 0.75 * overlapCoefficient);
}

export interface FuzzyMatch {
  value: string;
  score: number;
}

/**
 * Best fuzzy match of `input` against `candidates`.
 * Returns the match only when it clears `threshold`; near-misses are the
 * caller's cue to record a transform_observation with a suggested_value.
 */
export function bestMatch(
  input: string,
  candidates: readonly string[],
  threshold: number = FUZZY_MATCH_THRESHOLD,
): { match: FuzzyMatch | null; nearMiss: FuzzyMatch | null } {
  let best: FuzzyMatch | null = null;
  for (const candidate of candidates) {
    const score = similarity(input, candidate);
    if (!best || score > best.score) {
      best = { value: candidate, score };
    }
  }
  if (!best) return { match: null, nearMiss: null };
  if (best.score >= threshold) return { match: best, nearMiss: null };
  // A near-miss is close enough to suggest, not close enough to auto-accept.
  return { match: null, nearMiss: best.score >= 0.6 ? best : null };
}
