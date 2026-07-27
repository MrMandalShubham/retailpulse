import type { FastifyInstance } from "fastify";
import { desc, eq, schema } from "@dip/db";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read-only monitoring endpoints for the ingestion-control layer
 * (sources + crawl_jobs, the fetch-run log). Internal visibility only — not
 * part of the public Query API (Phase 4+).
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

      return { jobs };
    },
  );
}
