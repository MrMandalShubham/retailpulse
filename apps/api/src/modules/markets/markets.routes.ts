import type { FastifyInstance } from "fastify";
import { CROSS_BORDER_MARKET_CODE } from "@dip/domain";
import { asc, count, eq, schema } from "@dip/db";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Internal disclaimer attached to the XG market wherever it is served. */
const XG_NOTE =
  "XG is an internal user-assigned cross-border market code (ISO 3166 user-assigned range). It is NOT a country.";

/** Market mapping visibility (Phase 6). Read-only. */
export async function marketsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/markets", async () => {
    const markets = await app.db.select().from(schema.markets).orderBy(asc(schema.markets.name));
    const enriched = await Promise.all(
      markets.map(async (market) => ({
        ...market,
        ...(market.code === CROSS_BORDER_MARKET_CODE ? { note: XG_NOTE } : {}),
        sourceCount: await countWhere(
          app,
          schema.sourceMarkets,
          schema.sourceMarkets.marketId,
          market.id,
        ),
        productCount: await countWhere(
          app,
          schema.productMarkets,
          schema.productMarkets.marketId,
          market.id,
        ),
        priceFactCount: await countWhere(
          app,
          schema.productPriceFacts,
          schema.productPriceFacts.marketId,
          market.id,
        ),
        ratingFactCount: await countWhere(
          app,
          schema.productRatingFacts,
          schema.productRatingFacts.marketId,
          market.id,
        ),
      })),
    );
    return { markets: enriched };
  });

  app.get<{ Params: { id: string } }>("/markets/:id", async (request, reply) => {
    const market = await loadMarket(app, request.params.id, reply);
    if (!market) return;
    const sources = await mappedSources(app, market.id);
    return {
      market: {
        ...market,
        ...(market.code === CROSS_BORDER_MARKET_CODE ? { note: XG_NOTE } : {}),
      },
      sources,
      priceFactCount: await countWhere(
        app,
        schema.productPriceFacts,
        schema.productPriceFacts.marketId,
        market.id,
      ),
      ratingFactCount: await countWhere(
        app,
        schema.productRatingFacts,
        schema.productRatingFacts.marketId,
        market.id,
      ),
      productCount: await countWhere(
        app,
        schema.productMarkets,
        schema.productMarkets.marketId,
        market.id,
      ),
    };
  });

  app.get<{ Params: { id: string } }>("/markets/:id/sources", async (request, reply) => {
    const market = await loadMarket(app, request.params.id, reply);
    if (!market) return;
    return { marketId: market.id, sources: await mappedSources(app, market.id) };
  });
}

async function loadMarket(
  app: FastifyInstance,
  id: string,
  reply: { status(code: number): { send(body: unknown): unknown } },
) {
  if (!UUID_PATTERN.test(id)) {
    reply.status(400).send({ error: "market id must be a UUID" });
    return null;
  }
  const [market] = await app.db
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.id, id))
    .limit(1);
  if (!market) {
    reply.status(404).send({ error: "market not found" });
    return null;
  }
  return market;
}

async function mappedSources(app: FastifyInstance, marketId: string) {
  return app.db
    .select({
      sourceId: schema.sources.id,
      slug: schema.sources.slug,
      name: schema.sources.name,
      enabled: schema.sources.enabled,
      confidence: schema.sourceMarkets.confidence,
      notes: schema.sourceMarkets.notes,
    })
    .from(schema.sourceMarkets)
    .innerJoin(schema.sources, eq(schema.sourceMarkets.sourceId, schema.sources.id))
    .where(eq(schema.sourceMarkets.marketId, marketId));
}

async function countWhere(
  app: FastifyInstance,
  table: unknown,
  column: Parameters<typeof eq>[0],
  value: string,
): Promise<number> {
  const rows = await app.db
    .select({ n: count() })
    .from(table as typeof schema.markets)
    .where(eq(column, value));
  return Number(rows[0]?.n ?? 0);
}
