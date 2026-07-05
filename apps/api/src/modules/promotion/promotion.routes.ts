import type { FastifyInstance } from "fastify";
import { asc, desc, eq, schema } from "@dip/db";
import { createPromotionService } from "@dip/promotion";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Operator endpoints for canonical promotion — the ONLY HTTP surface that can
 * cause canonical writes, and only via the @dip/promotion gateway.
 */
export async function promotionRoutes(app: FastifyInstance): Promise<void> {
  const service = createPromotionService(app.db);

  app.get<{ Querystring: { limit?: string } }>("/promotion/runs", async (request, reply) => {
    const limit = parseLimit(request.query.limit);
    if (limit === null) return badRequest(reply, "limit must be an integer between 1 and 100");
    const runs = await app.db
      .select()
      .from(schema.promotionRuns)
      .orderBy(desc(schema.promotionRuns.createdAt))
      .limit(limit);
    return { runs };
  });

  app.get<{ Params: { id: string } }>("/promotion/runs/:id", async (request, reply) => {
    const { id } = request.params;
    if (!UUID_PATTERN.test(id)) return badRequest(reply, "run id must be a UUID");
    const [run] = await app.db
      .select()
      .from(schema.promotionRuns)
      .where(eq(schema.promotionRuns.id, id))
      .limit(1);
    if (!run) return reply.status(404).send({ error: "promotion run not found" });
    const items = await app.db
      .select()
      .from(schema.promotionItems)
      .where(eq(schema.promotionItems.promotionRunId, id))
      .orderBy(asc(schema.promotionItems.createdAt));
    return { run, items };
  });

  app.get<{ Querystring: { limit?: string } }>("/promotion/queue", async (request, reply) => {
    const limit = parseLimit(request.query.limit);
    if (limit === null) return badRequest(reply, "limit must be an integer between 1 and 100");
    const queue = await service.listQueue(limit);
    return {
      queue: queue.map((entry) => ({
        stagedProductId: entry.staged.id,
        sourceSlug: entry.sourceSlug,
        sourceUrl: entry.staged.sourceUrl,
        name: entry.staged.extractedName,
        brand: entry.staged.extractedBrand,
        confidenceScore: entry.staged.confidenceScore,
        validationStatus: entry.staged.validationStatus,
        unresolvedFields: entry.staged.unresolvedFields,
        eligible: entry.eligible,
        reasons: entry.reasons,
      })),
    };
  });

  app.post("/promotion/run", async (request) => {
    const summary = await service.runBatch(app.config.PROMOTION_MAX_ITEMS);
    request.log.info(
      { runId: summary.runId, promotedNew: summary.promotedNew, matched: summary.matchedExisting },
      "promotion batch triggered via API",
    );
    return summary;
  });

  app.post<{ Params: { stagedProductId: string }; Body: { operatorNote?: string } | null }>(
    "/promotion/items/:stagedProductId/promote",
    async (request, reply) => {
      const { stagedProductId } = request.params;
      if (!UUID_PATTERN.test(stagedProductId)) {
        return badRequest(reply, "stagedProductId must be a UUID");
      }
      const note =
        typeof request.body?.operatorNote === "string" ? request.body.operatorNote : undefined;
      const summary = await service.promoteSingle(stagedProductId, note);
      if (summary.totalItems === 0) {
        return reply.status(404).send({ error: "staged product not found" });
      }
      return summary;
    },
  );

  app.post<{ Params: { stagedProductId: string }; Body: { reason?: string } | null }>(
    "/promotion/items/:stagedProductId/reject",
    async (request, reply) => {
      const { stagedProductId } = request.params;
      if (!UUID_PATTERN.test(stagedProductId)) {
        return badRequest(reply, "stagedProductId must be a UUID");
      }
      const reason = request.body?.reason?.trim();
      // Operator reason is REQUIRED (approved decision) — it goes in the audit trail.
      if (!reason) return badRequest(reply, "a non-empty 'reason' is required to reject");
      const result = await service.reject(stagedProductId, reason);
      if (!result.ok) return reply.status(404).send({ error: result.error });
      return { rejected: true };
    },
  );
}

function parseLimit(raw: string | undefined): number | null {
  const limit = Number.parseInt(raw ?? "20", 10);
  return Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : null;
}

function badRequest(
  reply: { status(code: number): { send(body: unknown): unknown } },
  error: string,
) {
  return reply.status(400).send({ error });
}
