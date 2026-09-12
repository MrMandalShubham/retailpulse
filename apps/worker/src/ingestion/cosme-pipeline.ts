import { and, eq, inArray, schema, type Db } from "@dip/db";
import {
  assembleCosmeClean,
  cosmeSourceHash,
  cosmeTranslationSource,
  parseCosmeEnvelope,
  type CosmeCleanProduct,
} from "../platform/cosme-clean.js";
import type { Translator } from "../platform/translate.js";
import type { CosmeProductResult } from "./cosme.js";

/**
 * Storage-free ingest cycle for @cosme (Japan). Same shape as the Olive Young
 * cycle (reads pending map rows, fetches in memory, writes the clean store +
 * daily snapshot, flips the map row to ingested), with one addition: the clean
 * step is async because JA→EN translation happens here. Translation is cached in
 * the clean store — if a product's Japanese source is unchanged since last
 * ingest (matching source_hash), the stored English is reused and Mistral is not
 * called. A failed fetch/parse leaves the map row pending for a later run.
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

/** Cached translation (keys: name/brand/category) for a product whose source is unchanged. */
export type CachedTranslation = Record<string, string>;

export interface CosmeSyncRepo {
  getSourceBySlug(slug: string): Promise<{ id: string; slug: string } | null>;
  listPendingProducts(sourceId: string, limit: number): Promise<PendingProduct[]>;
  createRun(sourceId: string): Promise<{ id: string }>;
  finishRun(
    runId: string,
    status: "succeeded" | "failed",
    errorMessage?: string | null,
  ): Promise<void>;
  /** EN fields cached on the existing clean row IFF its source_hash matches. */
  getCachedTranslation(productId: string, sourceHash: string): Promise<CachedTranslation | null>;
  upsertClean(row: CosmeCleanProduct): Promise<void>;
  upsertSnapshot(row: CosmeCleanProduct): Promise<void>;
  markProductsIngested(ids: string[]): Promise<void>;
}

export interface CosmeSyncDeps {
  repo: CosmeSyncRepo;
  fetchProduct(productId: string, productUrl: string): Promise<CosmeProductResult>;
  translator: Translator;
  logger: SyncLogger;
  sourceSlug: string;
  maxProducts: number;
  interRequestDelayMs?: number;
}

export interface SyncSummary {
  sourceSlug: string;
  runId: string | null;
  considered: number;
  cleaned: number;
  snapshots: number;
  translated: number;
  cacheHits: number;
  failed: number;
  markedIngested: number;
  status: "succeeded" | "failed" | "skipped";
}

export async function runCosmeSyncCycle(deps: CosmeSyncDeps): Promise<SyncSummary> {
  const skip = (status: SyncSummary["status"]): SyncSummary => ({
    sourceSlug: deps.sourceSlug,
    runId: null,
    considered: 0,
    cleaned: 0,
    snapshots: 0,
    translated: 0,
    cacheHits: 0,
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
  deps.logger.info(
    { source: deps.sourceSlug, runId, products: products.length },
    "cosme ingest started",
  );

  let cleaned = 0;
  let failed = 0;
  let translated = 0;
  let cacheHits = 0;
  const ingestedIds: string[] = [];

  try {
    for (const [i, product] of products.entries()) {
      if (i > 0 && deps.interRequestDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, deps.interRequestDelayMs));
      }
      const result = await deps.fetchProduct(product.productId, product.productUrl);
      const parsed = result.ok ? parseCosmeEnvelope(result.envelope) : null;
      if (!parsed) {
        failed += 1;
        deps.logger.warn(
          { source: deps.sourceSlug, productId: product.productId, status: result.httpStatus },
          "product fetch/parse failed",
        );
        continue;
      }

      const sourceHash = cosmeSourceHash(parsed);
      let translations = await deps.repo.getCachedTranslation(product.productId, sourceHash);
      if (translations) {
        cacheHits += 1;
      } else {
        translations = await deps.translator.translate(cosmeTranslationSource(parsed));
        translated += 1;
      }

      const row = assembleCosmeClean(parsed, translations, sourceHash);
      await deps.repo.upsertClean(row);
      await deps.repo.upsertSnapshot(row);
      ingestedIds.push(product.id);
      cleaned += 1;
    }

    if (ingestedIds.length > 0) await deps.repo.markProductsIngested(ingestedIds);
    const status = cleaned > 0 ? "succeeded" : "failed";
    await deps.repo.finishRun(
      runId,
      status,
      status === "failed" ? `all ${products.length} product fetches failed` : null,
    );
    deps.logger.info(
      { source: deps.sourceSlug, runId, cleaned, failed, translated, cacheHits },
      "cosme ingest complete",
    );
    return {
      sourceSlug: deps.sourceSlug,
      runId,
      considered: products.length,
      cleaned,
      snapshots: cleaned,
      translated,
      cacheHits,
      failed,
      markedIngested: ingestedIds.length,
      status,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.repo.finishRun(runId, "failed", message);
    deps.logger.error({ source: deps.sourceSlug, runId, error: message }, "cosme ingest crashed");
    return { ...skip("failed"), runId, considered: products.length };
  }
}

/** Drizzle-backed CosmeSyncRepo: map reads + crawl_jobs run log + clean/snapshot writes. */
export function createCosmeSyncRepo(db: Db): CosmeSyncRepo {
  const dpp = schema.discoveredProductPages;
  const prod = schema.cosmeJpProducts;
  const snap = schema.cosmeJpProductSnapshots;
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

    async getCachedTranslation(productId, sourceHash) {
      const [row] = await db
        .select({
          sourceHash: prod.sourceHash,
          nameEn: prod.nameEn,
          brandNameEn: prod.brandNameEn,
          categoryEn: prod.categoryEn,
        })
        .from(prod)
        .where(eq(prod.productId, productId))
        .limit(1);
      if (!row || !row.sourceHash || row.sourceHash !== sourceHash) return null;
      const out: CachedTranslation = {};
      if (row.nameEn) out.name = row.nameEn;
      if (row.brandNameEn) out.brand = row.brandNameEn;
      if (row.categoryEn) out.category = row.categoryEn;
      return out;
    },

    async upsertClean(row) {
      await db
        .insert(prod)
        .values(row)
        .onConflictDoUpdate({ target: prod.productId, set: { ...row, updatedAt: new Date() } });
    },

    async upsertSnapshot(row) {
      const capturedAt = (row.fetchedAt ?? new Date()).toISOString().slice(0, 10);
      const values = {
        rating: row.rating,
        ratingRaw: row.ratingRaw,
        reviewCount: row.reviewCount,
        rankInCategory: row.rankInCategory,
        price: row.price,
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
