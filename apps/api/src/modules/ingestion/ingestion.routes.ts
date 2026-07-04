import type { FastifyInstance } from "fastify";
import { count, desc, eq, inArray, schema } from "@dip/db";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read-only Phase 2 monitoring endpoints for the raw ingestion layer.
 * Internal visibility only — not part of the public Query API (Phase 4+).
 */
export async function ingestionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/ingestion/sources", async () => {
    const rows = await app.db.select().from(schema.sources).orderBy(schema.sources.name);
    return { sources: rows };
  });

  app.get<{ Querystring: { sourceId?: string; limit?: string } }>(
    "/ingestion/jobs",
    async (request, reply) => {
      const limit = Number.parseInt(request.query.limit ?? "20", 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return reply.status(400).send({ error: "limit must be an integer between 1 and 100" });
      }
      const { sourceId } = request.query;
      if (sourceId !== undefined && !UUID_PATTERN.test(sourceId)) {
        return reply.status(400).send({ error: "sourceId must be a UUID" });
      }

      const jobs = await app.db
        .select()
        .from(schema.crawlJobs)
        .where(sourceId ? eq(schema.crawlJobs.sourceId, sourceId) : undefined)
        .orderBy(desc(schema.crawlJobs.createdAt))
        .limit(limit);

      const countsByJob = new Map<string, number>();
      if (jobs.length > 0) {
        const counts = await app.db
          .select({ crawlJobId: schema.rawDocuments.crawlJobId, docCount: count() })
          .from(schema.rawDocuments)
          .where(
            inArray(
              schema.rawDocuments.crawlJobId,
              jobs.map((job) => job.id),
            ),
          )
          .groupBy(schema.rawDocuments.crawlJobId);
        for (const row of counts) {
          countsByJob.set(row.crawlJobId, Number(row.docCount));
        }
      }

      return {
        jobs: jobs.map((job) => ({ ...job, rawDocumentCount: countsByJob.get(job.id) ?? 0 })),
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/ingestion/jobs/:id/raw-documents",
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_PATTERN.test(id)) {
        return reply.status(400).send({ error: "job id must be a UUID" });
      }
      const [job] = await app.db
        .select()
        .from(schema.crawlJobs)
        .where(eq(schema.crawlJobs.id, id))
        .limit(1);
      if (!job) {
        return reply.status(404).send({ error: "crawl job not found" });
      }
      const documents = await app.db
        .select()
        .from(schema.rawDocuments)
        .where(eq(schema.rawDocuments.crawlJobId, id))
        .orderBy(schema.rawDocuments.fetchedAt);
      return { job: { id: job.id, sourceId: job.sourceId, status: job.status }, documents };
    },
  );
}
