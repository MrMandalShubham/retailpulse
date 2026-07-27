import { and, eq, inArray, schema, type Db } from "@dip/db";
import { mapEnvelopeToCleanProduct, type CleanProduct } from "../platform/oliveyoung-clean.js";
import type { OyProductResult } from "./oliveyoung.js";

/**
 * Storage-free ingest cycle. Reads `pending` products from the Phase 0 map,
 * fetches each product's API envelope IN MEMORY, transforms it straight into the
 * clean per-platform table + a time-series snapshot, and flips the map row to
 * `ingested`. No object storage, no raw layer — the clean table IS the product.
 * A failed fetch leaves the map row pending so a later run retries it.
 */

export interface PendingProduct {
  id: string;
  productId: string;
  productUrl: string;
}

export interface SyncLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface SyncRepo {
  getSourceBySlug(slug: string): Promise<{ id: string; slug: string } | null>;
  listPendingProducts(sourceId: string, limit: number): Promise<PendingProduct[]>;
  createRun(sourceId: string): Promise<{ id: string }>;
  finishRun(
    runId: string,
    status: "succeeded" | "failed",
    errorMessage?: string | null,
  ): Promise<void>;
  upsertClean(row: CleanProduct): Promise<void>;
  upsertSnapshot(row: CleanProduct): Promise<void>;
  markProductsIngested(ids: string[]): Promise<void>;
}

export interface SyncDeps {
  repo: SyncRepo;
  fetchProduct(productId: string, productUrl: string): Promise<OyProductResult>;
  logger: SyncLogger;
  sourceSlug: string;
  maxProducts: number;
  /** Politeness delay between product fetches. */
  interRequestDelayMs?: number;
}

export interface SyncSummary {
  sourceSlug: string;
  runId: string | null;
  considered: number;
  cleaned: number;
  snapshots: number;
  failed: number;
  markedIngested: number;
  status: "succeeded" | "failed" | "skipped";
}

export async function runSyncCycle(deps: SyncDeps): Promise<SyncSummary> {
  const skip = (status: SyncSummary["status"]): SyncSummary => ({
    sourceSlug: deps.sourceSlug,
    runId: null,
    considered: 0,
    cleaned: 0,
    snapshots: 0,
    failed: 0,
    markedIngested: 0,
    status,
  });

  const source = await deps.repo.getSourceBySlug(deps.sourceSlug);
  if (!source) {
    deps.logger.warn({ source: deps.sourceSlug }, "source not found — skipped");
    return skip("skipped");
  }

  const products = await deps.repo.listPendingProducts(source.id, deps.maxProducts);
  if (products.length === 0) {
    deps.logger.info({ source: deps.sourceSlug }, "no pending products — nothing to ingest");
    return skip("skipped");
  }

  const { id: runId } = await deps.repo.createRun(source.id);
  deps.logger.info({ source: deps.sourceSlug, runId, products: products.length }, "ingest started");

  let cleaned = 0;
  let failed = 0;
  const ingestedIds: string[] = [];

  try {
    for (const [i, product] of products.entries()) {
      if (i > 0 && deps.interRequestDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, deps.interRequestDelayMs));
      }
      const result = await deps.fetchProduct(product.productId, product.productUrl);
      const row = result.ok ? mapEnvelopeToCleanProduct(result.envelope) : null;
      if (row) {
        await deps.repo.upsertClean(row);
        await deps.repo.upsertSnapshot(row);
        ingestedIds.push(product.id);
        cleaned += 1;
      } else {
        // detail-data failed (delisted / transient) — leave the row pending.
        failed += 1;
        deps.logger.warn(
          {
            source: deps.sourceSlug,
            productId: product.productId,
            statuses: result.endpointStatuses,
          },
          "product fetch failed",
        );
      }
    }

    if (ingestedIds.length > 0) await deps.repo.markProductsIngested(ingestedIds);
    const status = cleaned > 0 ? "succeeded" : "failed";
    await deps.repo.finishRun(
      runId,
      status,
      status === "failed" ? `all ${products.length} product fetches failed` : null,
    );
    deps.logger.info(
      { source: deps.sourceSlug, runId, cleaned, failed, markedIngested: ingestedIds.length },
      "ingest complete",
    );
    return {
      sourceSlug: deps.sourceSlug,
      runId,
      considered: products.length,
      cleaned,
      snapshots: cleaned,
      failed,
      markedIngested: ingestedIds.length,
      status,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.repo.finishRun(runId, "failed", message);
    deps.logger.error({ source: deps.sourceSlug, runId, error: message }, "ingest crashed");
    return { ...skip("failed"), runId, considered: products.length };
  }
}

/** Drizzle-backed SyncRepo: map reads + crawl_jobs run log + clean/snapshot writes. */
export function createSyncRepo(db: Db): SyncRepo {
  const dpp = schema.discoveredProductPages;
  const prod = schema.oliveyoungGlobalProducts;
  const snap = schema.oliveyoungGlobalProductSnapshots;
  return {
    async getSourceBySlug(slug) {
      const [row] = await db
        .select({ id: schema.sources.id, slug: schema.sources.slug })
        .from(schema.sources)
        .where(eq(schema.sources.slug, slug))
        .limit(1);
      return row ?? null;
    },

    async listPendingProducts(sourceId, limit) {
      return db
        .select({ id: dpp.id, productId: dpp.productId, productUrl: dpp.productUrl })
        .from(dpp)
        .where(and(eq(dpp.sourceId, sourceId), eq(dpp.batchStatus, "pending")))
        .orderBy(dpp.createdAt)
        .limit(limit);
    },

    async createRun(sourceId) {
      const [row] = await db
        .insert(schema.crawlJobs)
        .values({ sourceId, status: "running", startedAt: new Date() })
        .returning({ id: schema.crawlJobs.id });
      if (!row) throw new Error("failed to create ingest run");
      return row;
    },

    async finishRun(runId, status, errorMessage) {
      await db
        .update(schema.crawlJobs)
        .set({ status, finishedAt: new Date(), errorMessage: errorMessage ?? null })
        .where(eq(schema.crawlJobs.id, runId));
    },

    async upsertClean(row) {
      await db
        .insert(prod)
        .values(row)
        .onConflictDoUpdate({ target: prod.productId, set: { ...row, updatedAt: new Date() } });
    },

    async upsertSnapshot(row) {
      // captured_at = the fetch date (real observation date). Idempotent per day.
      const capturedAt = (row.fetchedAt ?? new Date()).toISOString().slice(0, 10);
      const values = {
        regularPrice: row.regularPrice,
        salePrice: row.salePrice,
        discountRate: row.discountRate,
        avgRating: row.avgRating,
        reviewCount: row.reviewCount,
        stockQty: row.stockQty,
      };
      await db
        .insert(snap)
        .values({ productId: row.productId, capturedAt, ...values })
        .onConflictDoUpdate({ target: [snap.productId, snap.capturedAt], set: values });
    },

    async markProductsIngested(ids) {
      if (ids.length === 0) return;
      await db.update(dpp).set({ batchStatus: "ingested" }).where(inArray(dpp.id, ids));
    },
  };
}
