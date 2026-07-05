import { AMBIGUOUS_SIMILARITY_FLOOR, AUTO_MATCH_SIMILARITY_THRESHOLD } from "@dip/domain";
import { fold, similarity } from "./text.js";

export interface MatchCandidate {
  id: string;
  name: string;
}

export type MatchResult =
  | {
      kind: "matched";
      productId: string;
      strategy: "exact_brand_name" | "fuzzy_brand_name";
      score: number;
    }
  | { kind: "ambiguous"; candidateId: string; candidateName: string; score: number }
  | { kind: "none" };

/**
 * Deterministic same-brand identity matching (pure, unit-testable).
 * exact folded-name -> matched (1.0); similarity >= 0.9 AND agreeing numeric
 * tokens -> matched; high similarity with DIFFERENT numbers (size/volume
 * variants like "250ml" vs "100ml") -> AMBIGUOUS, never auto-merged;
 * [0.75, 0.9) -> AMBIGUOUS (caller must keep the record staged);
 * below 0.75 -> no match (safe to create a new product).
 */
export function pickMatch(name: string, candidates: MatchCandidate[]): MatchResult {
  const foldedName = fold(name);
  let best: { candidate: MatchCandidate; score: number } | null = null;

  for (const candidate of candidates) {
    if (fold(candidate.name) === foldedName) {
      return { kind: "matched", productId: candidate.id, strategy: "exact_brand_name", score: 1 };
    }
    const score = similarity(name, candidate.name);
    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }
  if (!best) return { kind: "none" };
  const score = Math.round(best.score * 1000) / 1000;

  if (
    best.score >= AUTO_MATCH_SIMILARITY_THRESHOLD &&
    digitRuns(name) === digitRuns(best.candidate.name)
  ) {
    return { kind: "matched", productId: best.candidate.id, strategy: "fuzzy_brand_name", score };
  }
  if (best.score >= AMBIGUOUS_SIMILARITY_FLOOR) {
    return {
      kind: "ambiguous",
      candidateId: best.candidate.id,
      candidateName: best.candidate.name,
      score,
    };
  }
  return { kind: "none" };
}

/**
 * All digit sequences in a name, sorted — "Essence 100ml" -> "100".
 * Two names whose digits disagree are likely different sizes/versions of a
 * product line; edit distance alone cannot see that on long names.
 */
function digitRuns(name: string): string {
  return (fold(name).match(/\d+/g) ?? []).sort().join("|");
}
