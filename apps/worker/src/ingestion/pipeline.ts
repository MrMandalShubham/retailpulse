import { MAX_SEED_URLS_PER_JOB, type RawStorageAdapter } from "@dip/domain";
import type { FetchResult } from "./fetcher.js";
import { buildRawStorageKey, sha256Hex } from "./keys.js";

/**
 * Phase 2 ingestion pipeline: DB config -> HTTP fetch -> object storage ->
 * raw_documents metadata. Dependencies are injected so the pipeline is
 * unit-testable without Postgres or real object storage.
 *
 * This pipeline writes ONLY to the raw layer. Nothing here may ever touch the
 * normalized 8-table core — that is the Phase 3 transform layer's job.
 */

/** Projection of a source with just what the pipeline needs. */
export interface PipelineSource {
  id: string;
  slug: string;
  name: string;
  seedUrls: string[];
}

export interface NewRawDocumentInput {
  crawlJobId: string;
  sourceId: string;
  url: string;
  contentType: string | null;
  storageKey: string | null;
  checksum: string | null;
  status: "ok" | "error" | "skipped";
  httpStatus: number | null;
  responseBytes: number | null;
  errorMessage: string | null;
  fetchedAt: Date;
}

export interface IngestionRepo {
  listEnabledSources(): Promise<PipelineSource[]>;
  createCrawlJob(sourceId: string): Promise<{ id: string }>;
  markJobRunning(jobId: string): Promise<void>;
  markJobFinished(
    jobId: string,
    status: "succeeded" | "failed",
    errorMessage?: string | null,
  ): Promise<void>;
  insertRawDocument(doc: NewRawDocumentInput): Promise<void>;
}

export interface PipelineLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface PipelineDeps {
  repo: IngestionRepo;
  storage: RawStorageAdapter;
  fetchUrl(url: string): Promise<FetchResult>;
  logger: PipelineLogger;
  /** Politeness delay between requests to the same source. */
  interRequestDelayMs?: number;
  /** Max seed URLs per job; falls back to the MAX_SEED_URLS_PER_JOB default. */
  maxSeedUrls?: number;
}

export interface CycleSummary {
  sourcesProcessed: number;
  sourcesSkipped: number;
  jobsSucceeded: number;
  jobsFailed: number;
  documentsOk: number;
  documentsFailed: number;
}

export async function runIngestionCycle(deps: PipelineDeps): Promise<CycleSummary> {
  const summary: CycleSummary = {
    sourcesProcessed: 0,
    sourcesSkipped: 0,
    jobsSucceeded: 0,
    jobsFailed: 0,
    documentsOk: 0,
    documentsFailed: 0,
  };

  const sources = await deps.repo.listEnabledSources();
  for (const source of sources) {
    if (source.seedUrls.length === 0) {
      deps.logger.warn({ source: source.slug }, "source has no seed URLs — skipping");
      summary.sourcesSkipped += 1;
      continue;
    }
    summary.sourcesProcessed += 1;
    await ingestSource(source, deps, summary);
  }
  return summary;
}

async function ingestSource(
  source: PipelineSource,
  deps: PipelineDeps,
  summary: CycleSummary,
): Promise<void> {
  const urls = source.seedUrls.slice(0, deps.maxSeedUrls ?? MAX_SEED_URLS_PER_JOB);
  const { id: jobId } = await deps.repo.createCrawlJob(source.id);
  deps.logger.info({ source: source.slug, jobId, urls: urls.length }, "crawl job started");

  try {
    await deps.repo.markJobRunning(jobId);
    let okCount = 0;

    for (const [i, url] of urls.entries()) {
      if (i > 0 && deps.interRequestDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, deps.interRequestDelayMs));
      }
      const fetchedAt = new Date();
      const result = await deps.fetchUrl(url);

      if (result.ok && result.body) {
        const storageKey = buildRawStorageKey({
          sourceSlug: source.slug,
          crawlJobId: jobId,
          url,
          contentType: result.contentType,
          fetchedAt,
        });
        await deps.storage.put(storageKey, result.body, result.contentType ?? "text/html");
        await deps.repo.insertRawDocument({
          crawlJobId: jobId,
          sourceId: source.id,
          url,
          contentType: result.contentType,
          storageKey,
          checksum: sha256Hex(result.body),
          status: "ok",
          httpStatus: result.httpStatus,
          responseBytes: result.body.byteLength,
          errorMessage: null,
          fetchedAt,
        });
        okCount += 1;
        summary.documentsOk += 1;
      } else {
        await deps.repo.insertRawDocument({
          crawlJobId: jobId,
          sourceId: source.id,
          url,
          contentType: result.contentType,
          storageKey: null,
          checksum: null,
          status: "error",
          httpStatus: result.httpStatus,
          responseBytes: null,
          errorMessage: result.errorMessage,
          fetchedAt,
        });
        summary.documentsFailed += 1;
        deps.logger.warn({ source: source.slug, url, error: result.errorMessage }, "fetch failed");
      }
    }

    if (okCount > 0) {
      await deps.repo.markJobFinished(jobId, "succeeded");
      summary.jobsSucceeded += 1;
      deps.logger.info({ source: source.slug, jobId, okCount }, "crawl job succeeded");
    } else {
      await deps.repo.markJobFinished(jobId, "failed", `all ${urls.length} fetches failed`);
      summary.jobsFailed += 1;
      deps.logger.error({ source: source.slug, jobId }, "crawl job failed: no successful fetches");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.repo.markJobFinished(jobId, "failed", message);
    summary.jobsFailed += 1;
    deps.logger.error({ source: source.slug, jobId, error: message }, "crawl job crashed");
  }
}
