import type { FastifyInstance } from "fastify";
import {
  AI_REVIEW_ITEM_STATUSES,
  AI_RULE_SUGGESTION_STATUSES,
  type AiReviewItemStatus,
  type AiRuleSuggestionStatus,
} from "@dip/domain";
import { and, count, desc, eq, schema } from "@dip/db";
import { approveRuleSuggestion, rejectRuleSuggestion } from "./approve.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Operator endpoints for the AI review layer: read visibility plus the
 * controlled approve/reject actions for AI rule suggestions.
 * TODO(later phase): full human moderation UI sits on top of these.
 */
export async function aiReviewsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { limit?: string } }>("/ai-reviews/runs", async (request, reply) => {
    const limit = parseLimit(request.query.limit);
    if (limit === null) return badRequest(reply, "limit must be an integer between 1 and 100");
    const runs = await app.db
      .select()
      .from(schema.aiReviewRuns)
      .orderBy(desc(schema.aiReviewRuns.createdAt))
      .limit(limit);
    return { runs };
  });

  app.get<{ Params: { id: string } }>("/ai-reviews/runs/:id", async (request, reply) => {
    const { id } = request.params;
    if (!UUID_PATTERN.test(id)) return badRequest(reply, "run id must be a UUID");
    const [run] = await app.db
      .select()
      .from(schema.aiReviewRuns)
      .where(eq(schema.aiReviewRuns.id, id))
      .limit(1);
    if (!run) return reply.status(404).send({ error: "ai review run not found" });

    const itemCounts = await app.db
      .select({ status: schema.aiReviewItems.status, n: count() })
      .from(schema.aiReviewItems)
      .where(eq(schema.aiReviewItems.aiReviewRunId, id))
      .groupBy(schema.aiReviewItems.status);
    return {
      run,
      itemCounts: Object.fromEntries(itemCounts.map((row) => [row.status, Number(row.n)])),
    };
  });

  app.get<{ Querystring: { status?: string; provider?: string; limit?: string } }>(
    "/ai-reviews/items",
    async (request, reply) => {
      const limit = parseLimit(request.query.limit);
      if (limit === null) return badRequest(reply, "limit must be an integer between 1 and 100");
      const { status, provider } = request.query;
      if (status !== undefined && !AI_REVIEW_ITEM_STATUSES.includes(status as AiReviewItemStatus)) {
        return badRequest(reply, `status must be one of: ${AI_REVIEW_ITEM_STATUSES.join(", ")}`);
      }

      const conditions = [];
      if (status) conditions.push(eq(schema.aiReviewItems.status, status));
      if (provider) conditions.push(eq(schema.aiReviewItems.providerName, provider));

      const items = await app.db
        .select()
        .from(schema.aiReviewItems)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schema.aiReviewItems.createdAt))
        .limit(limit);
      return { items };
    },
  );

  app.get<{ Querystring: { status?: string; limit?: string } }>(
    "/ai-reviews/rule-suggestions",
    async (request, reply) => {
      const limit = parseLimit(request.query.limit);
      if (limit === null) return badRequest(reply, "limit must be an integer between 1 and 100");
      const { status } = request.query;
      if (
        status !== undefined &&
        !AI_RULE_SUGGESTION_STATUSES.includes(status as AiRuleSuggestionStatus)
      ) {
        return badRequest(
          reply,
          `status must be one of: ${AI_RULE_SUGGESTION_STATUSES.join(", ")}`,
        );
      }
      const suggestions = await app.db
        .select()
        .from(schema.aiRuleSuggestions)
        .where(status ? eq(schema.aiRuleSuggestions.status, status) : undefined)
        .orderBy(desc(schema.aiRuleSuggestions.createdAt))
        .limit(limit);
      return { ruleSuggestions: suggestions };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/ai-reviews/rule-suggestions/:id/approve",
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_PATTERN.test(id)) return badRequest(reply, "suggestion id must be a UUID");
      const result = await approveRuleSuggestion(app.db, id);
      if (!result.ok) return reply.status(result.code).send({ error: result.error });
      request.log.info({ suggestionId: id, ruleId: result.ruleId }, "ai rule suggestion promoted");
      return { promoted: true, ruleId: result.ruleId };
    },
  );

  app.post<{ Params: { id: string }; Body: { notes?: string } | null }>(
    "/ai-reviews/rule-suggestions/:id/reject",
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_PATTERN.test(id)) return badRequest(reply, "suggestion id must be a UUID");
      const notes = typeof request.body?.notes === "string" ? request.body.notes : undefined;
      const result = await rejectRuleSuggestion(app.db, id, notes);
      if (!result.ok) return reply.status(result.code).send({ error: result.error });
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
