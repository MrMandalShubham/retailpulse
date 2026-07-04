import { and, eq, schema, type Db } from "@dip/db";

/**
 * Controlled approval path for AI-discovered rules — the ONLY way an AI
 * suggestion becomes a normalization_rules row (learned_from_ai = true).
 * Operator-triggered via the API; the worker pipeline can never do this.
 * Writes touch the staging/AI layer only — never the canonical core.
 */

export type ApprovalResult =
  { ok: true; ruleId: string } | { ok: false; code: 404 | 409 | 422; error: string };

export async function approveRuleSuggestion(db: Db, suggestionId: string): Promise<ApprovalResult> {
  return db.transaction(async (tx): Promise<ApprovalResult> => {
    const [suggestion] = await tx
      .select()
      .from(schema.aiRuleSuggestions)
      .where(eq(schema.aiRuleSuggestions.id, suggestionId))
      .limit(1);
    if (!suggestion) {
      return { ok: false, code: 404, error: "rule suggestion not found" };
    }
    if (suggestion.status !== "open") {
      return {
        ok: false,
        code: 422,
        error: `rule suggestion is '${suggestion.status}' — only open suggestions can be approved`,
      };
    }

    const [existingRule] = await tx
      .select({ id: schema.normalizationRules.id })
      .from(schema.normalizationRules)
      .where(
        and(
          eq(schema.normalizationRules.ruleType, suggestion.ruleType),
          eq(schema.normalizationRules.sourceScope, suggestion.sourceScope),
          eq(schema.normalizationRules.matchKey, suggestion.matchKey),
        ),
      )
      .limit(1);
    if (existingRule) {
      return {
        ok: false,
        code: 409,
        error: `a rule with the same (type, scope, match_key) already exists: ${existingRule.id}`,
      };
    }

    const [rule] = await tx
      .insert(schema.normalizationRules)
      .values({
        ruleType: suggestion.ruleType,
        sourceScope: suggestion.sourceScope,
        matchKey: suggestion.matchKey,
        matchValue: suggestion.matchValue,
        normalizedKey: suggestion.normalizedKey,
        normalizedValue: suggestion.normalizedValue,
        learnedFromAi: true,
        notes: `promoted from ai_rule_suggestions/${suggestion.id}`,
      })
      .returning({ id: schema.normalizationRules.id });
    if (!rule) throw new Error("failed to insert normalization rule");

    await tx
      .update(schema.aiRuleSuggestions)
      .set({ status: "promoted" })
      .where(eq(schema.aiRuleSuggestions.id, suggestion.id));

    if (suggestion.observationId) {
      await tx
        .update(schema.transformObservations)
        .set({ status: "promoted_to_rule" })
        .where(eq(schema.transformObservations.id, suggestion.observationId));
    }

    return { ok: true, ruleId: rule.id };
  });
}

export async function rejectRuleSuggestion(
  db: Db,
  suggestionId: string,
  notes?: string,
): Promise<ApprovalResult> {
  return db.transaction(async (tx): Promise<ApprovalResult> => {
    const [suggestion] = await tx
      .select({ id: schema.aiRuleSuggestions.id, status: schema.aiRuleSuggestions.status })
      .from(schema.aiRuleSuggestions)
      .where(eq(schema.aiRuleSuggestions.id, suggestionId))
      .limit(1);
    if (!suggestion) {
      return { ok: false, code: 404, error: "rule suggestion not found" };
    }
    if (suggestion.status !== "open") {
      return {
        ok: false,
        code: 422,
        error: `rule suggestion is '${suggestion.status}' — only open suggestions can be rejected`,
      };
    }
    await tx
      .update(schema.aiRuleSuggestions)
      .set({ status: "rejected", ...(notes ? { notes } : {}) })
      .where(eq(schema.aiRuleSuggestions.id, suggestionId));
    return { ok: true, ruleId: suggestion.id };
  });
}
