import { describe, expect, it } from "vitest";
import {
  promoteObservationToRule,
  type PromoteRuleInput,
  type PromotionRepo,
} from "../src/transform/promote.js";

function makeFakeRepo(initialStatus: string | null) {
  const state = {
    status: initialStatus,
    insertedRules: [] as PromoteRuleInput[],
  };
  const repo: PromotionRepo = {
    getObservationStatus: async () => state.status,
    insertRule: async (rule) => {
      state.insertedRules.push(rule);
      return { ruleId: "rule-1" };
    },
    markObservationPromoted: async () => {
      state.status = "promoted_to_rule";
    },
  };
  return { repo, state };
}

const BRAND_RULE: PromoteRuleInput = {
  ruleType: "brand_alias",
  sourceScope: "global",
  matchKey: "dr jart",
  normalizedValue: "Dr. Jart+",
  learnedFromAi: false,
};

describe("promoteObservationToRule", () => {
  it("inserts the rule and marks the observation promoted", async () => {
    const { repo, state } = makeFakeRepo("open");
    const result = await promoteObservationToRule(repo, "obs-1", BRAND_RULE);
    expect(result.ruleId).toBe("rule-1");
    expect(state.insertedRules).toHaveLength(1);
    expect(state.status).toBe("promoted_to_rule");
  });

  it("rejects unknown observations and already-promoted ones", async () => {
    const missing = makeFakeRepo(null);
    await expect(promoteObservationToRule(missing.repo, "nope", BRAND_RULE)).rejects.toThrow(
      /not found/,
    );

    const promoted = makeFakeRepo("promoted_to_rule");
    await expect(promoteObservationToRule(promoted.repo, "obs-2", BRAND_RULE)).rejects.toThrow(
      /cannot promote/,
    );
    expect(promoted.state.insertedRules).toHaveLength(0);
  });
});
