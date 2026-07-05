import type { SourceMarketConfidence } from "@dip/domain";
import {
  periodMonth,
  validatePriceCandidate,
  validateRatingCandidate,
  weekEnding,
} from "./validate.js";

/**
 * Phase 6 fact pipeline: deterministic, DB-only, APPEND-ONLY.
 *
 * Evidence spine = promotion_items (every promoted/matched staged observation)
 * joined to its staged payload and raw document fetch time. Each evidence row
 * can yield one price fact and one rating fact ('observed'). Market is stamped
 * only from source_markets mappings; unmapped sources keep market_id = null.
 *
 * Core rollups (the FIRST honest writes to retail_pulse_prices /
 * voice_pulse_reviews) happen ONLY when market is known; first observation per
 * period wins, later same-period observations stay at observation grain.
 * product_markets is upserted ONLY for 'confirmed' mappings.
 */

export interface FactEvidence {
  stagedProductId: string;
  productId: string;
  sourceId: string | null;
  sourceSlug: string | null;
  sourceUrl: string;
  observedAt: Date;
  confidenceScore: string | null;
  priceValue: number | null;
  priceCurrency: string | null;
  priceOriginalText: string | null;
  ratingValue: number | null;
  reviewCount: number | null;
  ratingOriginalText: string | null;
}

export interface MarketMapping {
  marketId: string;
  confidence: SourceMarketConfidence;
}

export interface NewFactBase {
  productId: string;
  sourceId: string | null;
  sourceSlug: string | null;
  stagedProductId: string;
  marketId: string | null;
  factType: "observed";
  observedAt: Date;
  confidenceScore: string | null;
  sourceUrl: string;
}

export interface FactRepo {
  listFactEvidence(limit: number): Promise<FactEvidence[]>;
  loadSourceMarkets(): Promise<Map<string, MarketMapping>>;
  createRun(): Promise<{ id: string }>;
  finishRun(
    runId: string,
    status: "succeeded" | "failed",
    counters: {
      productsConsidered: number;
      priceFactsInserted: number;
      ratingFactsInserted: number;
      duplicatesSkipped: number;
      skippedInvalid: number;
      coreRollupsInserted: number;
    },
    errorMessage?: string | null,
  ): Promise<void>;
  /** Returns true when inserted, false when the dedup anchor skipped it. */
  insertPriceFact(
    runId: string,
    fact: NewFactBase & {
      priceValue: string;
      priceCurrency: string;
      priceOriginalText: string | null;
    },
  ): Promise<boolean>;
  insertRatingFact(
    runId: string,
    fact: NewFactBase & {
      ratingValue: string;
      reviewCount: number | null;
      ratingOriginalText: string | null;
    },
  ): Promise<boolean>;
  /** Rollups: insert only if the (product, market, slug, period) row is absent. */
  insertPriceRollupIfAbsent(input: {
    productId: string;
    marketId: string;
    retailer: string;
    priceValue: string;
    currency: string;
    weekEnding: string;
  }): Promise<boolean>;
  insertRatingRollupIfAbsent(input: {
    productId: string;
    marketId: string;
    platform: string;
    avgRating: string;
    reviewCount: number | null;
    periodMonth: string;
  }): Promise<boolean>;
  upsertProductMarket(productId: string, marketId: string): Promise<void>;
}

export interface FactLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface FactSummary {
  runId: string | null;
  productsConsidered: number;
  priceFactsInserted: number;
  ratingFactsInserted: number;
  duplicatesSkipped: number;
  skippedInvalid: number;
  coreRollupsInserted: number;
}

export async function runFactCycle(deps: {
  repo: FactRepo;
  logger: FactLogger;
  maxProducts: number;
}): Promise<FactSummary> {
  const summary: FactSummary = {
    runId: null,
    productsConsidered: 0,
    priceFactsInserted: 0,
    ratingFactsInserted: 0,
    duplicatesSkipped: 0,
    skippedInvalid: 0,
    coreRollupsInserted: 0,
  };

  const [evidence, mappings] = await Promise.all([
    deps.repo.listFactEvidence(deps.maxProducts),
    deps.repo.loadSourceMarkets(),
  ]);
  if (evidence.length === 0) {
    deps.logger.info({}, "no promoted evidence — nothing to extract facts from");
    return summary;
  }

  const { id: runId } = await deps.repo.createRun();
  summary.runId = runId;
  summary.productsConsidered = evidence.length;

  try {
    for (const row of evidence) {
      const mapping = row.sourceId ? (mappings.get(row.sourceId) ?? null) : null;
      const marketId = mapping?.marketId ?? null;
      const base: NewFactBase = {
        productId: row.productId,
        sourceId: row.sourceId,
        sourceSlug: row.sourceSlug,
        stagedProductId: row.stagedProductId,
        marketId,
        factType: "observed",
        observedAt: row.observedAt,
        confidenceScore: row.confidenceScore,
        sourceUrl: row.sourceUrl,
      };

      // ---- price fact ----------------------------------------------------
      if (row.priceValue !== null) {
        const check = validatePriceCandidate({
          value: row.priceValue,
          currency: row.priceCurrency,
          observedAt: row.observedAt,
        });
        if (!check.ok) {
          summary.skippedInvalid += 1;
          deps.logger.warn({ url: row.sourceUrl, reason: check.reason }, "price fact rejected");
        } else {
          const inserted = await deps.repo.insertPriceFact(runId, {
            ...base,
            priceValue: check.value.value.toFixed(2),
            priceCurrency: check.value.currency,
            priceOriginalText: row.priceOriginalText,
          });
          if (inserted) {
            summary.priceFactsInserted += 1;
            if (marketId && row.sourceSlug) {
              const rolled = await deps.repo.insertPriceRollupIfAbsent({
                productId: row.productId,
                marketId,
                retailer: row.sourceSlug,
                priceValue: check.value.value.toFixed(2),
                currency: check.value.currency,
                weekEnding: weekEnding(row.observedAt),
              });
              if (rolled) summary.coreRollupsInserted += 1;
            }
          } else {
            summary.duplicatesSkipped += 1;
          }
        }
      }

      // ---- rating fact ---------------------------------------------------
      if (row.ratingValue !== null) {
        const check = validateRatingCandidate({
          value: row.ratingValue,
          reviewCount: row.reviewCount,
          observedAt: row.observedAt,
        });
        if (!check.ok) {
          summary.skippedInvalid += 1;
          deps.logger.warn({ url: row.sourceUrl, reason: check.reason }, "rating fact rejected");
        } else {
          const inserted = await deps.repo.insertRatingFact(runId, {
            ...base,
            ratingValue: check.value.value.toFixed(2),
            reviewCount: check.value.reviewCount,
            ratingOriginalText: row.ratingOriginalText,
          });
          if (inserted) {
            summary.ratingFactsInserted += 1;
            if (marketId && row.sourceSlug) {
              const rolled = await deps.repo.insertRatingRollupIfAbsent({
                productId: row.productId,
                marketId,
                platform: row.sourceSlug,
                avgRating: check.value.value.toFixed(2),
                reviewCount: check.value.reviewCount,
                periodMonth: periodMonth(row.observedAt),
              });
              if (rolled) summary.coreRollupsInserted += 1;
            }
          } else {
            summary.duplicatesSkipped += 1;
          }
        }
      }

      // ---- product availability (confirmed mappings only) -----------------
      if (mapping && mapping.confidence === "confirmed") {
        await deps.repo.upsertProductMarket(row.productId, mapping.marketId);
      }
    }

    await deps.repo.finishRun(runId, "succeeded", summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.repo.finishRun(runId, "failed", summary, message);
    deps.logger.error({ error: message }, "fact cycle failed");
    throw err;
  }
  return summary;
}
