/**
 * AI review pipeline end-to-end with the mock provider and an in-memory repo —
 * no Postgres, no network, deterministic.
 */
import { describe, expect, it } from "vitest";
import { createMockProvider } from "@dip/ai";
import type { AIReviewDecision } from "@dip/domain";
import {
  observationReviewReason,
  runAiReviewCycle,
  stagedProductReviewReason,
  type AiReviewRepo,
  type EligibleObservation,
  type EligibleStagedProduct,
  type NewAiReviewItem,
} from "../src/ai-review/pipeline.js";

interface FakeState {
  repo: AiReviewRepo;
  runs: Array<{ id: string; status: string; totalItems: number; counters?: unknown }>;
  items: Array<
    NewAiReviewItem & {
      id: string;
      status: string;
      confidenceScore?: string;
      errorMessage?: string;
      parsedDecision?: Record<string, unknown>;
      outputPayload?: Record<string, unknown>;
    }
  >;
  suggestions: Array<{ itemId: string; observationId: string | null; fingerprint: string }>;
}

function makeFakeRepo(
  staged: EligibleStagedProduct[],
  observations: EligibleObservation[],
): FakeState {
  const state: FakeState = {
    runs: [],
    items: [],
    suggestions: [],
    repo: undefined as unknown as AiReviewRepo,
  };
  state.repo = {
    listEligibleStagedProducts: async (limit) => staged.slice(0, Math.max(limit, 0)),
    listEligibleObservations: async (limit) => observations.slice(0, Math.max(limit, 0)),
    createRun: async (_provider, _model, totalItems) => {
      const run = { id: `run-${state.runs.length + 1}`, status: "pending", totalItems };
      state.runs.push(run);
      return { id: run.id };
    },
    markRunRunning: async (runId) => {
      const run = state.runs.find((r) => r.id === runId);
      if (run) run.status = "running";
    },
    finishRun: async (runId, status, counters) => {
      const run = state.runs.find((r) => r.id === runId);
      if (run) {
        run.status = status;
        run.counters = counters;
      }
    },
    insertItem: async (_runId, item) => {
      const stored = { ...item, id: `item-${state.items.length + 1}`, status: "pending" };
      state.items.push(stored);
      return { id: stored.id };
    },
    completeItem: async (itemId, result) => {
      const item = state.items.find((i) => i.id === itemId);
      if (item) {
        item.status = result.status;
        item.confidenceScore = result.confidenceScore;
        item.parsedDecision = result.parsedDecision;
        item.outputPayload = result.outputPayload;
      }
    },
    failItem: async (itemId, errorMessage) => {
      const item = state.items.find((i) => i.id === itemId);
      if (item) {
        item.status = "failed";
        item.errorMessage = errorMessage;
      }
    },
    insertRuleSuggestions: async (itemId, observationId, decision: AIReviewDecision) => {
      let inserted = 0;
      for (const rule of decision.suggestedRules) {
        // Mirrors the partial-unique fingerprint guard.
        const fingerprint = `${observationId}|${rule.ruleType}|${rule.sourceScope}|${rule.matchKey}`;
        if (!state.suggestions.some((s) => s.fingerprint === fingerprint)) {
          state.suggestions.push({ itemId, observationId, fingerprint });
          inserted += 1;
        }
      }
      return inserted;
    },
  };
  return state;
}

const silentLogger = { info() {}, warn() {}, error() {} };

const STAGED_NEEDS_REVIEW: EligibleStagedProduct = {
  id: "staged-1",
  sourceSlug: "test-store",
  sourceUrl: "https://shop.test/product/serum",
  pageType: "product",
  dominantSignal: "jsonld_product",
  extracted: { name: "Repair Serum", brand: "cosrx", price_text: null },
  fieldConfidences: { name: 0.9 },
  unresolvedFields: ["brand", "price_text"],
  validationStatus: "needs_review",
  validationErrors: [],
};

const OBS_UNKNOWN_BRAND: EligibleObservation = {
  id: "obs-1",
  sourceSlug: "test-store",
  observationType: "unknown_brand",
  fieldName: "brand",
  rawValue: "drjart",
  suggestedValue: "Dr. Jart+",
  notes: null,
};

const OBS_UNKNOWN_TYPE: EligibleObservation = {
  id: "obs-2",
  sourceSlug: "test-store",
  observationType: "unknown_product_type",
  fieldName: "product_type",
  rawValue: "Advanced Snail 96 Mucin Power Essence 100ml",
  suggestedValue: null,
  notes: null,
};

describe("runAiReviewCycle", () => {
  it("creates no run when nothing is eligible (selective escalation)", async () => {
    const state = makeFakeRepo([], []);
    const summary = await runAiReviewCycle({
      repo: state.repo,
      provider: createMockProvider(),
      logger: silentLogger,
      maxItems: 20,
    });
    expect(summary.runId).toBeNull();
    expect(state.runs).toHaveLength(0);
  });

  it("reviews staged products and observations, persisting decisions and suggestions", async () => {
    const state = makeFakeRepo([STAGED_NEEDS_REVIEW], [OBS_UNKNOWN_BRAND, OBS_UNKNOWN_TYPE]);
    const summary = await runAiReviewCycle({
      repo: state.repo,
      provider: createMockProvider(),
      logger: silentLogger,
      maxItems: 20,
    });

    expect(summary).toMatchObject({
      totalItems: 3,
      processedItems: 3,
      succeededItems: 3,
      failedItems: 0,
    });
    expect(state.runs[0]?.status).toBe("succeeded");

    const stagedItem = state.items.find((i) => i.itemType === "staged_product");
    expect(stagedItem?.status).toBe("succeeded");
    expect(stagedItem?.reviewReason).toContain("unresolved fields: brand, price_text");
    expect(stagedItem?.outputPayload?.raw_text).toBeDefined();
    expect((stagedItem?.parsedDecision as { decisionType: string }).decisionType).toBe(
      "partially_resolved",
    );

    // unknown_brand -> brand_alias suggestion; unknown_product_type -> keyword rule.
    expect(summary.ruleSuggestions).toBe(2);
    expect(state.suggestions.map((s) => s.observationId)).toEqual(["obs-1", "obs-2"]);
  });

  it("skips duplicate open suggestions across repeated runs (fingerprint guard)", async () => {
    const state = makeFakeRepo([], [OBS_UNKNOWN_BRAND]);
    const deps = {
      repo: state.repo,
      provider: createMockProvider(),
      logger: silentLogger,
      maxItems: 20,
    };
    const first = await runAiReviewCycle(deps);
    const second = await runAiReviewCycle(deps); // fake repo re-lists the same observation
    expect(first.ruleSuggestions).toBe(1);
    expect(second.ruleSuggestions).toBe(0);
    expect(state.suggestions).toHaveLength(1);
  });

  it("maps rejected decisions to rejected items and counts provider failures", async () => {
    const noName: EligibleStagedProduct = {
      ...STAGED_NEEDS_REVIEW,
      id: "staged-2",
      extracted: { name: null },
    };
    const state = makeFakeRepo([noName], []);
    const provider = createMockProvider();
    const failing = {
      ...provider,
      reviewObservation: async () => {
        throw new Error("provider exploded");
      },
    };
    const summary = await runAiReviewCycle({
      repo: state.repo,
      provider: failing,
      logger: silentLogger,
      maxItems: 20,
    });
    expect(summary.rejectedItems).toBe(1);
    expect(state.items[0]?.status).toBe("rejected");

    const failState = makeFakeRepo([], [OBS_UNKNOWN_BRAND]);
    const failSummary = await runAiReviewCycle({
      repo: failState.repo,
      provider: failing,
      logger: silentLogger,
      maxItems: 20,
    });
    expect(failSummary.failedItems).toBe(1);
    expect(failState.items[0]?.status).toBe("failed");
    expect(failState.items[0]?.errorMessage).toContain("provider exploded");
    expect(failState.runs[0]?.status).toBe("failed");
  });

  it("builds human-readable review reasons", () => {
    expect(stagedProductReviewReason(STAGED_NEEDS_REVIEW)).toBe(
      "ai_recommended staged product (validation: needs_review); unresolved fields: brand, price_text",
    );
    expect(observationReviewReason(OBS_UNKNOWN_BRAND)).toBe(
      "open observation: unknown_brand (field: brand)",
    );
  });
});
