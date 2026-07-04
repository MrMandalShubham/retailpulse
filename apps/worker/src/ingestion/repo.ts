import { eq, schema, type Db } from "@dip/db";
import type { IngestionRepo } from "./pipeline.js";

/** Drizzle-backed implementation of the pipeline's repository boundary. */
export function createIngestionRepo(db: Db): IngestionRepo {
  return {
    async listEnabledSources() {
      const rows = await db.select().from(schema.sources).where(eq(schema.sources.enabled, true));
      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        seedUrls: row.seedUrls ?? [],
      }));
    },

    async createCrawlJob(sourceId) {
      const [row] = await db
        .insert(schema.crawlJobs)
        .values({ sourceId, status: "pending" })
        .returning({ id: schema.crawlJobs.id });
      if (!row) throw new Error(`failed to create crawl job for source ${sourceId}`);
      return row;
    },

    async markJobRunning(jobId) {
      await db
        .update(schema.crawlJobs)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(schema.crawlJobs.id, jobId));
    },

    async markJobFinished(jobId, status, errorMessage) {
      await db
        .update(schema.crawlJobs)
        .set({ status, finishedAt: new Date(), errorMessage: errorMessage ?? null })
        .where(eq(schema.crawlJobs.id, jobId));
    },

    async insertRawDocument(doc) {
      await db.insert(schema.rawDocuments).values(doc);
    },
  };
}
