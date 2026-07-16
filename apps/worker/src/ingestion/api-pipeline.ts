import { and, eq, inArray, schema, type Db } from "@dip/db";
import type { RawStorageAdapter } from "@dip/domain";
import { buildProductRawKey, sha256Hex } from "./keys.js";
import type { OyProductResult } from "./oliveyoung.js";
import { createIngestionRepo } from "./repo.js";
import type { NewRawDocumentInput, PipelineLogger } from "./pipeline.js";

/**
 * Phase 1 API ingestion pipeline. Reads `pending` products straight from the
 * Phase 0 map (discovered_product_pages), fetches each product's raw API
 * envelope, stores it UNCOMPRESSED in object storage, records a raw_documents
 * pointer, and flips the map row pending -> ingested. This is the explicit
 * Phase 0 -> Phase 1 hand-off. Writes ONLY the raw layer + the map status;
 * never the normalized core.
 */

export interface PendingProduct {
  id: string;
  productId: string;
  productUrl: string;
}

export interface ApiIngestionRepo {
  getSourceBySlug(slug: string): Promise<{ id: string; slug: string } | null>;
  listPendingProducts(sourceId: string, limit: number): Promise<PendingProduct[]>;
  createCrawlJob(sourceId: string): Promise<{ id: string }>;
  markJobRunning(jobId: string): Promise<void>;
  markJobFinished(
    jobId: string,
    status: "succeeded" | "failed",
    errorMessage?: string | null,
  ): Promise<void>;
  insertRawDocument(doc: NewRawDocumentInput): Promise<void>;
  markProductsIngested(ids: string[]): Promise<void>;
}

export interface ApiPipelineDeps {
  repo: ApiIngestionRepo;
  storage: RawStorageAdapter;
  fetchProduct(productId: string, productUrl: string): Promise<OyProductResult>;
  logger: PipelineLogger;
  sourceSlug: string;
  maxProducts: number;
  /** Politeness delay between product fetches. */
  interRequestDelayMs?: number;
}

export interface ApiCycleSummary {
  sourceSlug: string;
  jobId: string | null;
  productsConsidered: number;
  documentsOk: number;
  documentsFailed: number;
  markedIngested: number;
  status: "succeeded" | "failed" | "skipped";
}

export async function runApiIngestionCycle(deps: ApiPipelineDeps): Promise<ApiCycleSummary> {
  const skip = (status: ApiCycleSummary["status"]): ApiCycleSummary => ({
    sourceSlug: deps.sourceSlug,
    jobId: null,
    productsConsidered: 0,
    documentsOk: 0,
    documentsFailed: 0,
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

  const { id: jobId } = await deps.repo.createCrawlJob(source.id);
  await deps.repo.markJobRunning(jobId);
  deps.logger.info({ source: deps.sourceSlug, jobId, products: products.length }, "api ingest started");

  let documentsOk = 0;
  let documentsFailed = 0;
  const ingestedIds: string[] = [];

  try {
    for (const [i, product] of products.entries()) {
      if (i > 0 && deps.interRequestDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, deps.interRequestDelayMs));
      }
      const fetchedAt = new Date();
      const result = await deps.fetchProduct(product.productId, product.productUrl);
      const storageKey = buildProductRawKey({
        sourceSlug: source.slug,
        crawlJobId: jobId,
        productId: product.productId,
        fetchedAt,
      });

      if (result.ok) {
        // Store the raw envelope UNCOMPRESSED (.json) — gzip is deferred to the
        // end-of-flow archival step and never runs here.
        await deps.storage.put(storageKey, result.bytes, "application/json");
        await deps.repo.insertRawDocument({
          crawlJobId: jobId,
          sourceId: source.id,
          url: product.productUrl,
          contentType: "application/json",
          storageKey,
          checksum: sha256Hex(result.bytes),
          status: "ok",
          httpStatus: result.httpStatus,
          responseBytes: result.bytes.byteLength,
          errorMessage: null,
          fetchedAt,
        });
        ingestedIds.push(product.id);
        documentsOk += 1;
      } else {
        // Essential endpoint failed — record the failure, leave the map row
        // pending so a later run can retry it.
        await deps.repo.insertRawDocument({
          crawlJobId: jobId,
          sourceId: source.id,
          url: product.productUrl,
          contentType: "application/json",
          storageKey: null,
          checksum: null,
          status: "error",
          httpStatus: result.httpStatus,
          responseBytes: null,
          errorMessage: `detail-data failed (statuses: ${JSON.stringify(result.endpointStatuses)})`,
          fetchedAt,
        });
        documentsFailed += 1;
        deps.logger.warn(
          { source: deps.sourceSlug, productId: product.productId, statuses: result.endpointStatuses },
          "product fetch failed",
        );
      }
    }

    if (ingestedIds.length > 0) await deps.repo.markProductsIngested(ingestedIds);
    const status = documentsOk > 0 ? "succeeded" : "failed";
    await deps.repo.markJobFinished(
      jobId,
      status,
      status === "failed" ? `all ${products.length} product fetches failed` : null,
    );
    deps.logger.info(
      { source: deps.sourceSlug, jobId, documentsOk, documentsFailed, markedIngested: ingestedIds.length },
      "api ingest complete",
    );
    return {
      sourceSlug: deps.sourceSlug,
      jobId,
      productsConsidered: products.length,
      documentsOk,
      documentsFailed,
      markedIngested: ingestedIds.length,
      status,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.repo.markJobFinished(jobId, "failed", message);
    deps.logger.error({ source: deps.sourceSlug, jobId, error: message }, "api ingest crashed");
    return { ...skip("failed"), jobId, productsConsidered: products.length };
  }
}

/** Drizzle-backed ApiIngestionRepo: reuses the raw-layer repo, adds map reads. */
export function createApiIngestionRepo(db: Db): ApiIngestionRepo {
  const base = createIngestionRepo(db);
  const dpp = schema.discoveredProductPages;
  return {
    createCrawlJob: base.createCrawlJob,
    markJobRunning: base.markJobRunning,
    markJobFinished: base.markJobFinished,
    insertRawDocument: base.insertRawDocument,

    async getSourceBySlug(slug) {
      const [row] = await db
        .select({ id: schema.sources.id, slug: schema.sources.slug })
        .from(schema.sources)
        .where(eq(schema.sources.slug, slug))
        .limit(1);
      return row ?? null;
    },

    async listPendingProducts(sourceId, limit) {
      const rows = await db
        .select({ id: dpp.id, productId: dpp.productId, productUrl: dpp.productUrl })
        .from(dpp)
        .where(and(eq(dpp.sourceId, sourceId), eq(dpp.batchStatus, "pending")))
        .orderBy(dpp.createdAt)
        .limit(limit);
      return rows;
    },

    async markProductsIngested(ids) {
      if (ids.length === 0) return;
      await db
        .update(dpp)
        .set({ batchStatus: "ingested" })
        .where(inArray(dpp.id, ids));
    },
  };
}
