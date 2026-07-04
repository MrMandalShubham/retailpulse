import type {
  AIReviewDecision,
  AIReviewProvider,
  AiReviewItemType,
  ObservationType,
  PageType,
} from "@dip/domain";
import { buildObservationPayload, buildStagedProductPayload } from "@dip/ai";

/**
 * Phase 4 AI review pipeline: SELECTIVE escalation of Phase 3 leftovers.
 * Only gated items reach the provider; every request/response is persisted
 * for audit; rule suggestions land in ai_rule_suggestions and are NEVER
 * applied without the operator approval path. Canonical tables untouched.
 */

export interface EligibleStagedProduct {
  id: string;
  sourceSlug: string;
  sourceUrl: string | null;
  pageType: PageType | null;
  dominantSignal: string | null;
  extracted: Record<string, string | null>;
  fieldConfidences: Record<string, number>;
  unresolvedFields: string[];
  validationStatus: string;
  validationErrors: string[];
}

export interface EligibleObservation {
  id: string;
  sourceSlug: string;
  observationType: ObservationType;
  fieldName: string | null;
  rawValue: string | null;
  suggestedValue: string | null;
  notes: string | null;
}

export interface NewAiReviewItem {
  stagedProductId: string | null;
  observationId: string | null;
  itemType: AiReviewItemType;
  reviewReason: string;
  inputPayload: Record<string, unknown>;
}

export interface AiReviewRepo {
  listEligibleStagedProducts(limit: number): Promise<EligibleStagedProduct[]>;
  listEligibleObservations(limit: number): Promise<EligibleObservation[]>;
  createRun(providerName: string, modelName: string, totalItems: number): Promise<{ id: string }>;
  markRunRunning(runId: string): Promise<void>;
  finishRun(
    runId: string,
    status: "succeeded" | "failed",
    counters: { processed: number; succeeded: number; failed: number },
    errorMessage?: string | null,
  ): Promise<void>;
  insertItem(runId: string, item: NewAiReviewItem): Promise<{ id: string }>;
  completeItem(
    itemId: string,
    result: {
      status: "succeeded" | "rejected";
      outputPayload: Record<string, unknown>;
      parsedDecision: Record<string, unknown>;
      confidenceScore: string;
    },
  ): Promise<void>;
  failItem(itemId: string, errorMessage: string): Promise<void>;
  /** Insert suggestions; duplicates of still-open fingerprints are skipped. */
  insertRuleSuggestions(
    itemId: string,
    observationId: string | null,
    decision: AIReviewDecision,
  ): Promise<number>;
}

export interface AiReviewLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface AiReviewDeps {
  repo: AiReviewRepo;
  provider: AIReviewProvider;
  logger: AiReviewLogger;
  maxItems: number;
}

export interface AiReviewSummary {
  runId: string | null;
  totalItems: number;
  processedItems: number;
  succeededItems: number;
  failedItems: number;
  rejectedItems: number;
  ruleSuggestions: number;
}

export function stagedProductReviewReason(staged: EligibleStagedProduct): string {
  const unresolved =
    staged.unresolvedFields.length > 0 ? staged.unresolvedFields.join(", ") : "none";
  return `ai_recommended staged product (validation: ${staged.validationStatus}); unresolved fields: ${unresolved}`;
}

export function observationReviewReason(observation: EligibleObservation): string {
  const field = observation.fieldName ? ` (field: ${observation.fieldName})` : "";
  return `open observation: ${observation.observationType}${field}`;
}

export async function runAiReviewCycle(deps: AiReviewDeps): Promise<AiReviewSummary> {
  const summary: AiReviewSummary = {
    runId: null,
    totalItems: 0,
    processedItems: 0,
    succeededItems: 0,
    failedItems: 0,
    rejectedItems: 0,
    ruleSuggestions: 0,
  };

  // Staged products first (highest value), observations fill the remaining cap.
  const stagedProducts = await deps.repo.listEligibleStagedProducts(deps.maxItems);
  const observations = await deps.repo.listEligibleObservations(
    deps.maxItems - stagedProducts.length,
  );
  summary.totalItems = stagedProducts.length + observations.length;
  if (summary.totalItems === 0) {
    deps.logger.info({}, "no eligible items — selective escalation found nothing to review");
    return summary;
  }

  const { id: runId } = await deps.repo.createRun(
    deps.provider.providerName,
    deps.provider.modelName,
    summary.totalItems,
  );
  summary.runId = runId;
  await deps.repo.markRunRunning(runId);
  deps.logger.info(
    {
      runId,
      provider: deps.provider.providerName,
      stagedProducts: stagedProducts.length,
      observations: observations.length,
    },
    "ai review run started",
  );

  for (const staged of stagedProducts) {
    await reviewOne(deps, summary, runId, {
      item: {
        stagedProductId: staged.id,
        observationId: null,
        itemType: "staged_product",
        reviewReason: stagedProductReviewReason(staged),
        inputPayload: buildStagedProductPayload(staged),
      },
      review: () => deps.provider.reviewStagedProduct(staged),
    });
  }
  for (const observation of observations) {
    await reviewOne(deps, summary, runId, {
      item: {
        stagedProductId: null,
        observationId: observation.id,
        itemType: "observation",
        reviewReason: observationReviewReason(observation),
        inputPayload: buildObservationPayload(observation),
      },
      review: () => deps.provider.reviewObservation(observation),
    });
  }

  const runStatus =
    summary.failedItems > 0 && summary.succeededItems === 0 ? "failed" : "succeeded";
  await deps.repo.finishRun(runId, runStatus, {
    processed: summary.processedItems,
    succeeded: summary.succeededItems,
    failed: summary.failedItems,
  });
  return summary;
}

async function reviewOne(
  deps: AiReviewDeps,
  summary: AiReviewSummary,
  runId: string,
  work: { item: NewAiReviewItem; review: () => Promise<AIReviewDecision> },
): Promise<void> {
  summary.processedItems += 1;
  const { id: itemId } = await deps.repo.insertItem(runId, work.item);
  try {
    const decision = await work.review();
    const itemStatus = decision.decisionType === "rejected" ? "rejected" : "succeeded";
    await deps.repo.completeItem(itemId, {
      status: itemStatus,
      outputPayload: { raw_text: decision.rawResponse, trace_id: decision.traceId },
      parsedDecision: decisionToJson(decision),
      confidenceScore: decision.confidenceScore.toFixed(3),
    });
    if (itemStatus === "rejected") summary.rejectedItems += 1;
    summary.succeededItems += 1;

    if (decision.suggestedRules.length > 0) {
      const inserted = await deps.repo.insertRuleSuggestions(
        itemId,
        work.item.observationId,
        decision,
      );
      summary.ruleSuggestions += inserted;
      if (inserted < decision.suggestedRules.length) {
        deps.logger.info(
          { itemId, suggested: decision.suggestedRules.length, inserted },
          "duplicate open rule suggestions skipped (fingerprint guard)",
        );
      }
    }
  } catch (err) {
    summary.failedItems += 1;
    const message = err instanceof Error ? err.message : String(err);
    await deps.repo.failItem(itemId, message);
    deps.logger.error({ itemId, error: message }, "ai review item failed");
  }
}

function decisionToJson(decision: AIReviewDecision): Record<string, unknown> {
  // parsed_decision column stores the validated structure without the raw text
  // (raw text lives in output_payload).
  const structured: Record<string, unknown> = { ...decision };
  delete structured.rawResponse;
  return structured;
}
