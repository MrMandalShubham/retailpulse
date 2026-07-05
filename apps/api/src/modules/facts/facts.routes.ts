import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, lte, schema } from "@dip/db";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FactQuery {
  productId?: string;
  sourceSlug?: string;
  marketId?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

type FactTable = typeof schema.productPriceFacts | typeof schema.productRatingFacts;

/**
 * Read-only fact inspection (Phase 6). Facts are append-only observations;
 * these endpoints expose timelines, filters, and latest-per-source/market
 * views. market_id = null means the market is honestly unknown.
 */
export async function factsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: FactQuery }>("/facts/prices", async (request, reply) => {
    const parsed = parseFactQuery(request.query, schema.productPriceFacts);
    if (parsed.error !== undefined) return badRequest(reply, parsed.error);
    const facts = await app.db
      .select()
      .from(schema.productPriceFacts)
      .where(parsed.where)
      .orderBy(desc(schema.productPriceFacts.observedAt))
      .limit(parsed.limit)
      .offset(parsed.offset);
    return { facts };
  });

  app.get<{ Params: { productId: string } }>("/facts/prices/:productId", async (request, reply) => {
    const { productId } = request.params;
    if (!UUID_PATTERN.test(productId)) return badRequest(reply, "productId must be a UUID");
    const timeline = await app.db
      .select()
      .from(schema.productPriceFacts)
      .where(eq(schema.productPriceFacts.productId, productId))
      .orderBy(desc(schema.productPriceFacts.observedAt));
    return { productId, timeline, latest: latestPerSourceMarket(timeline) };
  });

  app.get<{ Querystring: FactQuery }>("/facts/ratings", async (request, reply) => {
    const parsed = parseFactQuery(request.query, schema.productRatingFacts);
    if (parsed.error !== undefined) return badRequest(reply, parsed.error);
    const facts = await app.db
      .select()
      .from(schema.productRatingFacts)
      .where(parsed.where)
      .orderBy(desc(schema.productRatingFacts.observedAt))
      .limit(parsed.limit)
      .offset(parsed.offset);
    return { facts };
  });

  app.get<{ Params: { productId: string } }>(
    "/facts/ratings/:productId",
    async (request, reply) => {
      const { productId } = request.params;
      if (!UUID_PATTERN.test(productId)) return badRequest(reply, "productId must be a UUID");
      const timeline = await app.db
        .select()
        .from(schema.productRatingFacts)
        .where(eq(schema.productRatingFacts.productId, productId))
        .orderBy(desc(schema.productRatingFacts.observedAt));
      return { productId, timeline, latest: latestPerSourceMarket(timeline) };
    },
  );
}

type ParsedFactQuery =
  | { error: string; where?: never; limit?: never; offset?: never }
  | { error?: never; where: ReturnType<typeof and>; limit: number; offset: number };

function parseFactQuery(query: FactQuery, table: FactTable): ParsedFactQuery {
  const limit = Number.parseInt(query.limit ?? "50", 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return { error: "limit must be an integer between 1 and 200" };
  }
  const offset = Number.parseInt(query.offset ?? "0", 10);
  if (!Number.isInteger(offset) || offset < 0) {
    return { error: "offset must be a non-negative integer" };
  }

  const conditions = [];
  if (query.productId !== undefined) {
    if (!UUID_PATTERN.test(query.productId)) return { error: "productId must be a UUID" };
    conditions.push(eq(table.productId, query.productId));
  }
  if (query.marketId !== undefined) {
    if (!UUID_PATTERN.test(query.marketId)) return { error: "marketId must be a UUID" };
    conditions.push(eq(table.marketId, query.marketId));
  }
  if (query.sourceSlug !== undefined) {
    conditions.push(eq(table.sourceSlug, query.sourceSlug));
  }
  for (const [name, raw, cmp] of [
    ["from", query.from, gte],
    ["to", query.to, lte],
  ] as const) {
    if (raw !== undefined) {
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) return { error: `${name} must be an ISO date` };
      conditions.push(cmp(table.observedAt, date));
    }
  }
  return { where: conditions.length > 0 ? and(...conditions) : undefined, limit, offset };
}

/** Latest fact per (sourceSlug, marketId) from a time-descending timeline. */
function latestPerSourceMarket<T extends { sourceSlug: string | null; marketId: string | null }>(
  timelineDesc: T[],
): T[] {
  const seen = new Set<string>();
  const latest: T[] = [];
  for (const fact of timelineDesc) {
    const key = `${fact.sourceSlug ?? "?"}|${fact.marketId ?? "unmapped"}`;
    if (!seen.has(key)) {
      seen.add(key);
      latest.push(fact);
    }
  }
  return latest;
}

function badRequest(
  reply: { status(code: number): { send(body: unknown): unknown } },
  error: string,
) {
  return reply.status(400).send({ error });
}
