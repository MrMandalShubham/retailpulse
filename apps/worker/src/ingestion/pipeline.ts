/**
 * Shared raw-ingestion repo boundary + types. The Phase 1 API ingestion
 * (api-pipeline.ts) implements the write side; createIngestionRepo (repo.ts)
 * backs it. The old HTML-crawl cycle was retired with the middle chain.
 */

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
