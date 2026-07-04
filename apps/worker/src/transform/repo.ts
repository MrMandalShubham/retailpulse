import { and, count, desc, eq, ilike, inArray, isNotNull, notExists, schema, sql, type Db } from "@dip/db";
import type {
  EligibleRawDocument,
  MasterData,
  ObservationDraft,
  StagedProductDraft,
  TransformRepo,
} from "./pipeline.js";
import type { RuleRow } from "./normalize/rule-engine.js";
import type { RuleType } from "@dip/domain";

/** Drizzle-backed implementation of the transform pipeline's repo boundary. */
export function createTransformRepo(db: Db): TransformRepo {
  return {
    async listEligibleRawDocuments({ limit, reprocess }) {
      const conditions = [
        eq(schema.rawDocuments.status, "ok"),
        isNotNull(schema.rawDocuments.storageKey),
        ilike(schema.rawDocuments.contentType, "%html%"),
      ];
      if (!reprocess) {
        // Unprocessed = no staged row AND no observation derived from the doc.
        conditions.push(
          notExists(
            db
              .select({ one: sql`1` })
              .from(schema.stagedProducts)
              .where(eq(schema.stagedProducts.rawDocumentId, schema.rawDocuments.id)),
          ),
          notExists(
            db
              .select({ one: sql`1` })
              .from(schema.transformObservations)
              .where(eq(schema.transformObservations.rawDocumentId, schema.rawDocuments.id)),
          ),
        );
      }
      const rows = await db
        .select({
          id: schema.rawDocuments.id,
          sourceId: schema.rawDocuments.sourceId,
          sourceSlug: schema.sources.slug,
          url: schema.rawDocuments.url,
          storageKey: schema.rawDocuments.storageKey,
        })
        .from(schema.rawDocuments)
        .innerJoin(schema.sources, eq(schema.rawDocuments.sourceId, schema.sources.id))
        .where(and(...conditions))
        .orderBy(desc(schema.rawDocuments.fetchedAt))
        .limit(limit);
      return rows.filter((r): r is EligibleRawDocument => r.storageKey !== null);
    },

    async deleteStagedForRawDocuments(rawDocumentIds) {
      if (rawDocumentIds.length === 0) return;
      await db
        .delete(schema.stagedProducts)
        .where(inArray(schema.stagedProducts.rawDocumentId, rawDocumentIds));
      // Open observations are regenerated; resolved/promoted/ignored are history.
      await db
        .delete(schema.transformObservations)
        .where(
          and(
            inArray(schema.transformObservations.rawDocumentId, rawDocumentIds),
            eq(schema.transformObservations.status, "open"),
          ),
        );
    },

    async createRun(totalDocuments) {
      const [row] = await db
        .insert(schema.transformRuns)
        .values({ status: "pending", totalDocuments })
        .returning({ id: schema.transformRuns.id });
      if (!row) throw new Error("failed to create transform run");
      return row;
    },

    async markRunRunning(runId) {
      await db
        .update(schema.transformRuns)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(schema.transformRuns.id, runId));
    },

    async finishRun(runId, status, counters, errorMessage) {
      await db
        .update(schema.transformRuns)
        .set({
          status,
          finishedAt: new Date(),
          processedDocuments: counters.processed,
          succeededDocuments: counters.succeeded,
          failedDocuments: counters.failed,
          errorMessage: errorMessage ?? null,
        })
        .where(eq(schema.transformRuns.id, runId));
    },

    async insertStagedProduct(runId, draft: StagedProductDraft) {
      const [row] = await db
        .insert(schema.stagedProducts)
        .values({ transformRunId: runId, ...draft })
        .returning({ id: schema.stagedProducts.id });
      if (!row) throw new Error("failed to insert staged product");
      return row;
    },

    async insertObservations(runId, stagedProductId, drafts: ObservationDraft[]) {
      if (drafts.length === 0) return;
      await db.insert(schema.transformObservations).values(
        drafts.map(({ attachToStaged, ...draft }) => ({
          transformRunId: runId,
          stagedProductId: attachToStaged ? stagedProductId : null,
          ...draft,
        })),
      );
    },

    async loadActiveRules(): Promise<RuleRow[]> {
      const rows = await db
        .select()
        .from(schema.normalizationRules)
        .where(eq(schema.normalizationRules.active, true));
      return rows.map((row) => ({
        id: row.id,
        ruleType: row.ruleType as RuleType,
        sourceScope: row.sourceScope,
        matchKey: row.matchKey,
        matchValue: row.matchValue,
        normalizedKey: row.normalizedKey,
        normalizedValue: row.normalizedValue,
        priority: row.priority,
        active: row.active,
      }));
    },

    async loadMasterData(): Promise<MasterData> {
      // READ-ONLY access to canonical master data for fuzzy matching.
      const [brands, categories, productTypes] = await Promise.all([
        db.select({ name: schema.brands.name }).from(schema.brands),
        db.select({ name: schema.categories.name }).from(schema.categories),
        db.select({ name: schema.productTypes.name }).from(schema.productTypes),
      ]);
      return {
        brands: brands.map((r) => r.name),
        categories: categories.map((r) => r.name),
        productTypes: productTypes.map((r) => r.name),
      };
    },
  };
}

/** Row counts used by verification to prove canonical tables stay untouched. */
export async function canonicalRowCounts(db: Db): Promise<Record<string, number>> {
  const tables = {
    products_master: schema.productsMaster,
    product_markets: schema.productMarkets,
    brands: schema.brands,
    categories: schema.categories,
    product_types: schema.productTypes,
    markets: schema.markets,
    retail_pulse_prices: schema.retailPulsePrices,
    voice_pulse_reviews: schema.voicePulseReviews,
  } as const;
  const counts: Record<string, number> = {};
  for (const [name, table] of Object.entries(tables)) {
    const [row] = await db.select({ n: count() }).from(table);
    counts[name] = Number(row?.n ?? 0);
  }
  return counts;
}
