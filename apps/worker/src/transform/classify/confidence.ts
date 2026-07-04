import {
  METHOD_WEIGHTS,
  UNRESOLVED_CONFIDENCE_THRESHOLD,
  type ExtractionMethod,
} from "@dip/domain";
import type { CandidateMap, FieldCandidate } from "../extract/html.js";
import { fold } from "../normalize/text.js";

export interface ResolvedField {
  value: string;
  confidence: number;
  method: ExtractionMethod;
  /** True when independent methods produced materially different values. */
  conflict: boolean;
  agreementCount: number;
}

/** Record-level weights: fields that matter most for a product record. */
const RECORD_FIELD_WEIGHTS: Record<string, number> = {
  name: 3,
  brand: 2,
  price_text: 2,
  category: 1,
  product_type: 1,
  image: 1,
  description: 0.5,
};

/**
 * Resolve one field from its candidates: group by folded value, score each
 * group by summed method weights, and reward agreement between independent
 * methods (+0.1 for two, +0.15 for three or more, capped at 1.0).
 * Disagreement between strong methods caps confidence at 0.5 and flags a
 * conflict — conflicts become observations, not silent picks.
 */
export function resolveField(candidates: FieldCandidate[] | undefined): ResolvedField | null {
  if (!candidates || candidates.length === 0) return null;

  const groups = new Map<
    string,
    { value: string; methods: Set<ExtractionMethod>; weight: number }
  >();
  for (const candidate of candidates) {
    const key = fold(candidate.value);
    if (!key) continue;
    const group = groups.get(key) ?? { value: candidate.value, methods: new Set(), weight: 0 };
    if (!group.methods.has(candidate.method)) {
      group.methods.add(candidate.method);
      group.weight += METHOD_WEIGHTS[candidate.method];
    }
    // Prefer the longest representative of the group (most informative form).
    if (candidate.value.length > group.value.length) group.value = candidate.value;
    groups.set(key, group);
  }
  if (groups.size === 0) return null;

  const ranked = [...groups.values()].sort((a, b) => b.weight - a.weight);
  const winner = ranked[0];
  if (!winner) return null;
  const runnerUp = ranked[1];

  const bestMethod = [...winner.methods].sort((a, b) => METHOD_WEIGHTS[b] - METHOD_WEIGHTS[a])[0];
  let confidence = METHOD_WEIGHTS[bestMethod ?? "dom_heuristic"];
  if (winner.methods.size === 2) confidence += 0.1;
  if (winner.methods.size >= 3) confidence += 0.15;

  // A strong dissenting group means the page disagrees with itself.
  const conflict = runnerUp !== undefined && runnerUp.weight >= 0.5;
  if (conflict) confidence = Math.min(confidence, 0.5);

  return {
    value: winner.value,
    confidence: Math.min(Math.round(confidence * 1000) / 1000, 1),
    method: bestMethod ?? "dom_heuristic",
    conflict,
    agreementCount: winner.methods.size,
  };
}

export interface FieldResolution {
  resolved: Map<string, ResolvedField>;
  fieldConfidences: Record<string, number>;
  unresolvedFields: string[];
  conflicts: string[];
}

/** Fields a product candidate is expected to have. */
const EXPECTED_FIELDS = ["name", "brand", "category", "product_type", "price_text", "image"];

export function resolveAllFields(candidates: CandidateMap): FieldResolution {
  const resolved = new Map<string, ResolvedField>();
  const fieldConfidences: Record<string, number> = {};
  const conflicts: string[] = [];

  for (const [field, fieldCandidates] of candidates) {
    const resolution = resolveField(fieldCandidates);
    if (resolution) {
      resolved.set(field, resolution);
      fieldConfidences[field] = resolution.confidence;
      if (resolution.conflict) conflicts.push(field);
    }
  }

  const unresolvedFields = EXPECTED_FIELDS.filter((field) => {
    const resolution = resolved.get(field);
    return !resolution || resolution.confidence < UNRESOLVED_CONFIDENCE_THRESHOLD;
  });

  return { resolved, fieldConfidences, unresolvedFields, conflicts };
}

/** Weighted mean over the fields that matter; fields absent count as zero. */
export function recordConfidence(fieldConfidences: Record<string, number>): number {
  let weightSum = 0;
  let scoreSum = 0;
  for (const [field, weight] of Object.entries(RECORD_FIELD_WEIGHTS)) {
    weightSum += weight;
    scoreSum += (fieldConfidences[field] ?? 0) * weight;
  }
  return Math.round((scoreSum / weightSum) * 1000) / 1000;
}

/** Dominant extraction method across resolved fields ("mixed" when split). */
export function dominantMethod(resolved: Map<string, ResolvedField>): ExtractionMethod | null {
  const counts = new Map<ExtractionMethod, number>();
  for (const field of resolved.values()) {
    counts.set(field.method, (counts.get(field.method) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  if (counts.size === 1) return [...counts.keys()][0] ?? null;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const second = ranked[1];
  if (top && second && top[1] > second[1] * 2) return top[0];
  return "mixed";
}
