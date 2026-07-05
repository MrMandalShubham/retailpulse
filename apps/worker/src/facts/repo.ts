import { and, desc, eq, inArray, isNotNull, schema, type Db } from "@dip/db";
import type { SourceMarketConfidence } from "@dip/domain";
import { normalizeSourceUrl } from "@dip/promotion";
import type { FactEvidence, FactRepo, MarketMapping } from "./pipeline.js";

/** Drizzle-backed repo for the fact pipeline. INSERT-only on fact tables. */
export function createFactRepo(db: Db): FactRepo {
  return {
    async listFactEvidence(limit): Promise<FactEvidence[]> {
      if (limit <= 0) return [];
      // Evidence spine: every staged observation that reached the canonical
      // catalog (promoted_new or matched_existing), with its raw fetch time.
      const rows = await db
        .select({
          stagedProductId: schema.stagedProducts.id,
          productId: schema.promotionItems.productId,
          sourceId: schema.stagedProducts.sourceId,
          sourceSlug: schema.sources.slug,
          sourceUrl: schema.stagedProducts.sourceUrl,
          normalizedPayload: schema.stagedProducts.normalizedPayload,
          extractedPriceText: schema.stagedProducts.extractedPriceText,
          extractedRatingText: schema.stagedProducts.extractedRatingText,
          confidenceScore: schema.stagedProducts.confidenceScore,
          fetchedAt: schema.rawDocuments.fetchedAt,
        })
        .from(schema.promotionItems)
        .innerJoin(
          schema.stagedProducts,
          eq(schema.promotionItems.stagedProductId, schema.stagedProducts.id),
        )
        .innerJoin(
          schema.rawDocuments,
          eq(schema.stagedProducts.rawDocumentId, schema.rawDocuments.id),
        )
        .leftJoin(schema.sources, eq(schema.stagedProducts.sourceId, schema.sources.id))
        .where(
          and(
            isNotNull(schema.promotionItems.productId),
            inArray(schema.promotionItems.decision, ["promoted_new", "matched_existing"]),
          ),
        )
        .orderBy(desc(schema.rawDocuments.fetchedAt))
        .limit(limit * 2); // slack for de-duplicating multiple items per staged row

      const seen = new Set<string>();
      const evidence: FactEvidence[] = [];
      for (const row of rows) {
        if (!row.productId || !row.sourceUrl || seen.has(row.stagedProductId)) continue;
        seen.add(row.stagedProductId);
        const payload = parsePayload(row.normalizedPayload);
        evidence.push({
          stagedProductId: row.stagedProductId,
          productId: row.productId,
          sourceId: row.sourceId,
          sourceSlug: row.sourceSlug,
          sourceUrl: normalizeSourceUrl(row.sourceUrl),
          observedAt: row.fetchedAt,
          confidenceScore: row.confidenceScore,
          priceValue: payload.price?.value ?? null,
          priceCurrency: payload.price?.currency ?? null,
          priceOriginalText: row.extractedPriceText,
          ratingValue: payload.rating?.value ?? null,
          reviewCount: payload.rating?.reviewCount ?? null,
          ratingOriginalText: row.extractedRatingText,
        });
        if (evidence.length >= limit) break;
      }
      return evidence;
    },

    async loadSourceMarkets(): Promise<Map<string, MarketMapping>> {
      const rows = await db.select().from(schema.sourceMarkets);
      const map = new Map<string, MarketMapping>();
      for (const row of rows) {
        // One mapping per source in V1; 'confirmed' wins over 'inferred'.
        const existing = map.get(row.sourceId);
        if (!existing || row.confidence === "confirmed") {
          map.set(row.sourceId, {
            marketId: row.marketId,
            confidence: row.confidence as SourceMarketConfidence,
          });
        }
      }
      return map;
    },

    async createRun() {
      const [row] = await db
        .insert(schema.factRuns)
        .values({ status: "running", startedAt: new Date() })
        .returning({ id: schema.factRuns.id });
      if (!row) throw new Error("failed to create fact run");
      return row;
    },

    async finishRun(runId, status, counters, errorMessage) {
      await db
        .update(schema.factRuns)
        .set({
          status,
          finishedAt: new Date(),
          productsConsidered: counters.productsConsidered,
          priceFactsInserted: counters.priceFactsInserted,
          ratingFactsInserted: counters.ratingFactsInserted,
          duplicatesSkipped: counters.duplicatesSkipped,
          skippedInvalid: counters.skippedInvalid,
          coreRollupsInserted: counters.coreRollupsInserted,
          errorMessage: errorMessage ?? null,
        })
        .where(eq(schema.factRuns.id, runId));
    },

    async insertPriceFact(runId, fact) {
      const inserted = await db
        .insert(schema.productPriceFacts)
        .values({ ...fact, factRunId: runId })
        .onConflictDoNothing()
        .returning({ id: schema.productPriceFacts.id });
      return inserted.length > 0;
    },

    async insertRatingFact(runId, fact) {
      const inserted = await db
        .insert(schema.productRatingFacts)
        .values({ ...fact, factRunId: runId })
        .onConflictDoNothing()
        .returning({ id: schema.productRatingFacts.id });
      return inserted.length > 0;
    },

    async insertPriceRollupIfAbsent(input) {
      // App-level period dedup (approved): first observation per
      // (product, market, retailer, week) wins; table stays append-only.
      const [existing] = await db
        .select({ id: schema.retailPulsePrices.id })
        .from(schema.retailPulsePrices)
        .where(
          and(
            eq(schema.retailPulsePrices.productId, input.productId),
            eq(schema.retailPulsePrices.marketId, input.marketId),
            eq(schema.retailPulsePrices.retailer, input.retailer),
            eq(schema.retailPulsePrices.weekEnding, input.weekEnding),
          ),
        )
        .limit(1);
      if (existing) return false;
      await db.insert(schema.retailPulsePrices).values({
        productId: input.productId,
        marketId: input.marketId,
        retailer: input.retailer,
        regularPrice: input.priceValue,
        currency: input.currency,
        weekEnding: input.weekEnding,
      });
      return true;
    },

    async insertRatingRollupIfAbsent(input) {
      const [existing] = await db
        .select({ id: schema.voicePulseReviews.id })
        .from(schema.voicePulseReviews)
        .where(
          and(
            eq(schema.voicePulseReviews.productId, input.productId),
            eq(schema.voicePulseReviews.marketId, input.marketId),
            eq(schema.voicePulseReviews.platform, input.platform),
            eq(schema.voicePulseReviews.periodMonth, input.periodMonth),
          ),
        )
        .limit(1);
      if (existing) return false;
      await db.insert(schema.voicePulseReviews).values({
        productId: input.productId,
        marketId: input.marketId,
        platform: input.platform,
        periodMonth: input.periodMonth,
        avgRating: input.avgRating,
        reviewCount: input.reviewCount,
      });
      return true;
    },

    async upsertProductMarket(productId, marketId) {
      await db
        .insert(schema.productMarkets)
        .values({ productId, marketId, status: "Active" })
        .onConflictDoNothing();
    },
  };
}

function parsePayload(raw: unknown): {
  price: { value: number; currency: string | null } | null;
  rating: { value: number; reviewCount: number | null } | null;
} {
  const payload = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const price = payload.price as { value?: unknown; currency?: unknown } | null | undefined;
  const rating = payload.rating as { value?: unknown; reviewCount?: unknown } | null | undefined;
  return {
    price:
      price && typeof price.value === "number"
        ? {
            value: price.value,
            currency: typeof price.currency === "string" ? price.currency : null,
          }
        : null,
    rating:
      rating && typeof rating.value === "number"
        ? {
            value: rating.value,
            reviewCount: typeof rating.reviewCount === "number" ? rating.reviewCount : null,
          }
        : null,
  };
}
