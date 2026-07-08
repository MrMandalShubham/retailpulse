import type { FastifyInstance } from "fastify";
import { ENRICHMENT_STATUSES, ENRICHABLE_FIELDS, type EnrichmentStatus } from "@dip/domain";
import { and, count, desc, eq, schema } from "@dip/db";
import { applyProposedEnrichment, rejectProposedEnrichment } from "@dip/enrichment";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = new Set(ENRICHABLE_FIELDS.map((f) => f.field));

/**
 * Phase 7 enrichment operator surface (read + the controlled review-gate).
 * Applying a proposed enrichment is the ONLY way a non-deterministic value
 * reaches canonical, and it is fill-if-null.
 */
export async function enrichmentRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { limit?: string } }>("/enrichment/runs", async (request, reply) => {
    const limit = parseLimit(request.query.limit);
    if (limit === null) return bad(reply, "limit must be 1..100");
    const runs = await app.db
      .select()
      .from(schema.enrichmentRuns)
      .orderBy(desc(schema.enrichmentRuns.createdAt))
      .limit(limit);
    return { runs };
  });

  app.get("/enrichment/stats", async () => {
    const rows = await app.db
      .select({
        field: schema.productEnrichments.fieldName,
        status: schema.productEnrichments.status,
        n: count(),
      })
      .from(schema.productEnrichments)
      .groupBy(schema.productEnrichments.fieldName, schema.productEnrichments.status);
    const byField: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      (byField[r.field] ??= {})[r.status] = Number(r.n);
    }
    return { byField };
  });

  app.get<{ Querystring: { status?: string; field?: string; limit?: string } }>(
    "/enrichment/proposals",
    async (request, reply) => {
      const limit = parseLimit(request.query.limit);
      if (limit === null) return bad(reply, "limit must be 1..100");
      const { status, field } = request.query;
      if (status !== undefined && !ENRICHMENT_STATUSES.includes(status as EnrichmentStatus)) {
        return bad(reply, `status must be one of: ${ENRICHMENT_STATUSES.join(", ")}`);
      }
      if (field !== undefined && !FIELDS.has(field)) return bad(reply, "unknown field");

      const conds = [];
      if (status) conds.push(eq(schema.productEnrichments.status, status));
      if (field) conds.push(eq(schema.productEnrichments.fieldName, field));
      const items = await app.db
        .select()
        .from(schema.productEnrichments)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(schema.productEnrichments.createdAt))
        .limit(limit);
      return { proposals: items };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/enrichment/proposals/:id/approve",
    async (request, reply) => {
      if (!UUID.test(request.params.id)) return bad(reply, "id must be a UUID");
      const result = await applyProposedEnrichment(app.db, request.params.id);
      if (!result.ok)
        return reply
          .status(result.error === "enrichment not found" ? 404 : 422)
          .send({ error: result.error });
      request.log.info({ id: request.params.id, column: result.column }, "enrichment applied");
      return { applied: true, column: result.column, value: result.value };
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } | null }>(
    "/enrichment/proposals/:id/reject",
    async (request, reply) => {
      if (!UUID.test(request.params.id)) return bad(reply, "id must be a UUID");
      const reason = typeof request.body?.reason === "string" ? request.body.reason : undefined;
      const result = await rejectProposedEnrichment(app.db, request.params.id, reason);
      if (!result.ok)
        return reply
          .status(result.error === "enrichment not found" ? 404 : 422)
          .send({ error: result.error });
      return { rejected: true };
    },
  );
}

function parseLimit(raw: string | undefined): number | null {
  const limit = Number.parseInt(raw ?? "50", 10);
  return Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : null;
}
function bad(reply: { status(c: number): { send(b: unknown): unknown } }, error: string) {
  return reply.status(400).send({ error });
}
