import type { RuleType } from "@dip/domain";

/**
 * Manual observation → rule promotion (the human-operated version of the
 * future AI learning loop). Writes ONLY to the staging layer:
 * inserts a normalization_rules row and marks the observation promoted.
 *
 * TODO(Phase 4): the AI review flow calls this same contract with
 * learnedFromAi = true after repeated identical resolutions.
 */

export interface PromoteRuleInput {
  ruleType: RuleType;
  sourceScope: string;
  matchKey: string;
  matchValue?: string | null;
  normalizedKey?: string | null;
  normalizedValue?: string | null;
  priority?: number;
  notes?: string | null;
  learnedFromAi: boolean;
}

export interface PromotionRepo {
  getObservationStatus(observationId: string): Promise<string | null>;
  insertRule(rule: PromoteRuleInput): Promise<{ ruleId: string }>;
  markObservationPromoted(observationId: string): Promise<void>;
}

export async function promoteObservationToRule(
  repo: PromotionRepo,
  observationId: string,
  rule: PromoteRuleInput,
): Promise<{ ruleId: string }> {
  const status = await repo.getObservationStatus(observationId);
  if (status === null) {
    throw new Error(`observation ${observationId} not found`);
  }
  if (status !== "open" && status !== "resolved") {
    throw new Error(`observation ${observationId} has status '${status}' — cannot promote`);
  }
  const { ruleId } = await repo.insertRule(rule);
  await repo.markObservationPromoted(observationId);
  return { ruleId };
}
