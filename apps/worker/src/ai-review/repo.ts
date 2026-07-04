import { and, eq, inArray, notExists, schema, sql, type Db } from "@dip/db";
import {
  AI_ELIGIBLE_OBSERVATION_TYPES,
  type AIReviewDecision,
  type ObservationType,
  type PageType,
} from "@dip/domain";
import type {
  AiReviewRepo,
  EligibleObservation,
  EligibleStagedProduct,
  NewAiReviewItem,
} from "./pipeline.js";

/**
 * Drizzle-backed repo for the AI review pipeline. The eligibility queries ARE
 * the gating (approved decision): ai_recommended staged products still in
 * needs_review/pending on product-ish pages, and open observations of the
 * approved types — each not already reviewed. Nothing else can reach AI.
 */
export function createAiReviewRepo(db: Db): AiReviewRepo {
  return {
    async listEligibleStagedProducts(limit): Promise<EligibleStagedProduct[]> {
      if (limit <= 0) return [];
      const rows = await db
        .select({
          id: schema.stagedProducts.id,
          sourceSlug: schema.sources.slug,
          sourceUrl: schema.stagedProducts.sourceUrl,
          pageType: schema.stagedProducts.pageType,
          dominantSignal: schema.stagedProducts.dominantSignal,
          extractedName: schema.stagedProducts.extractedName,
          extractedBrand: schema.stagedProducts.extractedBrand,
          extractedCategory: schema.stagedProducts.extractedCategory,
          extractedProductType: schema.stagedProducts.extractedProductType,
          extractedCurrency: schema.stagedProducts.extractedCurrency,
          extractedPriceText: schema.stagedProducts.extractedPriceText,
          fieldConfidences: schema.stagedProducts.fieldConfidences,
          unresolvedFields: schema.stagedProducts.unresolvedFields,
          validationStatus: schema.stagedProducts.validationStatus,
          validationErrors: schema.stagedProducts.validationErrors,
        })
        .from(schema.stagedProducts)
        .innerJoin(schema.sources, eq(schema.stagedProducts.sourceId, schema.sources.id))
        .where(
          and(
            eq(schema.stagedProducts.aiRecommended, true),
            inArray(schema.stagedProducts.validationStatus, ["needs_review", "pending"]),
            inArray(schema.stagedProducts.pageType, ["product", "unknown"]),
            notReviewed(db, "staged_product"),
          ),
        )
        .limit(limit);

      return rows.map((row) => ({
        id: row.id,
        sourceSlug: row.sourceSlug,
        sourceUrl: row.sourceUrl,
        pageType: row.pageType as PageType | null,
        dominantSignal: row.dominantSignal,
        extracted: {
          name: row.extractedName,
          brand: row.extractedBrand,
          category: row.extractedCategory,
          product_type: row.extractedProductType,
          currency: row.extractedCurrency,
          price_text: row.extractedPriceText,
        },
        fieldConfidences: (row.fieldConfidences ?? {}) as Record<string, number>,
        unresolvedFields: row.unresolvedFields ?? [],
        validationStatus: row.validationStatus,
        validationErrors: row.validationErrors ?? [],
      }));
    },

    async listEligibleObservations(limit): Promise<EligibleObservation[]> {
      if (limit <= 0) return [];
      const rows = await db
        .select({
          id: schema.transformObservations.id,
          sourceSlug: schema.sources.slug,
          observationType: schema.transformObservations.observationType,
          fieldName: schema.transformObservations.fieldName,
          rawValue: schema.transformObservations.rawValue,
          suggestedValue: schema.transformObservations.suggestedValue,
          notes: schema.transformObservations.notes,
        })
        .from(schema.transformObservations)
        .innerJoin(
          schema.rawDocuments,
          eq(schema.transformObservations.rawDocumentId, schema.rawDocuments.id),
        )
        .innerJoin(schema.sources, eq(schema.rawDocuments.sourceId, schema.sources.id))
        .where(
          and(
            eq(schema.transformObservations.status, "open"),
            inArray(schema.transformObservations.observationType, [
              ...AI_ELIGIBLE_OBSERVATION_TYPES,
            ]),
            notReviewed(db, "observation"),
          ),
        )
        .limit(limit);

      return rows.map((row) => ({
        ...row,
        observationType: row.observationType as ObservationType,
      }));
    },

    async createRun(providerName, modelName, totalItems) {
      const [row] = await db
        .insert(schema.aiReviewRuns)
        .values({ providerName, modelName, status: "pending", totalItems })
        .returning({ id: schema.aiReviewRuns.id });
      if (!row) throw new Error("failed to create ai review run");
      return row;
    },

    async markRunRunning(runId) {
      await db
        .update(schema.aiReviewRuns)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(schema.aiReviewRuns.id, runId));
    },

    async finishRun(runId, status, counters, errorMessage) {
      await db
        .update(schema.aiReviewRuns)
        .set({
          status,
          finishedAt: new Date(),
          processedItems: counters.processed,
          succeededItems: counters.succeeded,
          failedItems: counters.failed,
          errorMessage: errorMessage ?? null,
        })
        .where(eq(schema.aiReviewRuns.id, runId));
    },

    async insertItem(runId, item: NewAiReviewItem) {
      const [run] = await db
        .select({
          providerName: schema.aiReviewRuns.providerName,
          modelName: schema.aiReviewRuns.modelName,
        })
        .from(schema.aiReviewRuns)
        .where(eq(schema.aiReviewRuns.id, runId))
        .limit(1);
      if (!run) throw new Error(`ai review run ${runId} not found`);
      const [row] = await db
        .insert(schema.aiReviewItems)
        .values({
          aiReviewRunId: runId,
          stagedProductId: item.stagedProductId,
          observationId: item.observationId,
          itemType: item.itemType,
          reviewReason: item.reviewReason,
          providerName: run.providerName,
          modelName: run.modelName,
          inputPayload: item.inputPayload,
          status: "pending",
        })
        .returning({ id: schema.aiReviewItems.id });
      if (!row) throw new Error("failed to insert ai review item");
      return row;
    },

    async completeItem(itemId, result) {
      await db
        .update(schema.aiReviewItems)
        .set({
          status: result.status,
          outputPayload: result.outputPayload,
          parsedDecision: result.parsedDecision,
          confidenceScore: result.confidenceScore,
        })
        .where(eq(schema.aiReviewItems.id, itemId));
    },

    async failItem(itemId, errorMessage) {
      await db
        .update(schema.aiReviewItems)
        .set({ status: "failed", errorMessage })
        .where(eq(schema.aiReviewItems.id, itemId));
    },

    async insertRuleSuggestions(itemId, observationId, decision: AIReviewDecision) {
      if (decision.suggestedRules.length === 0) return 0;
      // ON CONFLICT DO NOTHING pairs with the partial unique fingerprint index:
      // an identical still-open suggestion for the same observation is skipped.
      const inserted = await db
        .insert(schema.aiRuleSuggestions)
        .values(
          decision.suggestedRules.map((rule) => ({
            aiReviewItemId: itemId,
            observationId,
            ruleType: rule.ruleType,
            sourceScope: rule.sourceScope,
            matchKey: rule.matchKey,
            matchValue: rule.matchValue,
            normalizedKey: rule.normalizedKey,
            normalizedValue: rule.normalizedValue,
            confidenceScore: rule.confidence.toFixed(3),
            status: "open",
            notes: rule.rationale,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: schema.aiRuleSuggestions.id });
      return inserted.length;
    },
  };
}

/** NOT EXISTS a settled review item for this staged product / observation. */
function notReviewed(db: Db, itemType: "staged_product" | "observation") {
  const fkColumn =
    itemType === "staged_product"
      ? schema.aiReviewItems.stagedProductId
      : schema.aiReviewItems.observationId;
  const parentId =
    itemType === "staged_product" ? schema.stagedProducts.id : schema.transformObservations.id;
  return notExists(
    db
      .select({ one: sql`1` })
      .from(schema.aiReviewItems)
      .where(
        and(
          eq(fkColumn, parentId),
          inArray(schema.aiReviewItems.status, ["succeeded", "rejected"]),
        ),
      ),
  );
}
