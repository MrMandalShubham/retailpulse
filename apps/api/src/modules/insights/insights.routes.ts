import type { FastifyInstance } from "fastify";
import { STALE_FACT_DAYS } from "@dip/domain";
import { count, desc, eq, isNull, notExists, schema, sql } from "@dip/db";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Freshness / coverage / source-health analytics (Phase 6) — computed queries
 * only (approved: no summary tables yet). Volumes are small; every number here
 * is derived live from the append-only fact layer.
 */
export async function insightsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/freshness/stats", async () => {
    const now = Date.now();
    const cutoff7 = new Date(now - 7 * 86_400_000);
    const cutoff30 = new Date(now - STALE_FACT_DAYS * 86_400_000);

    // Latest observation per product, per fact kind.
    const latestPrice = await app.db
      .select({
        productId: schema.productPriceFacts.productId,
        latest: sql<string>`max(${schema.productPriceFacts.observedAt})`,
      })
      .from(schema.productPriceFacts)
      .groupBy(schema.productPriceFacts.productId);
    const latestRating = await app.db
      .select({
        productId: schema.productRatingFacts.productId,
        latest: sql<string>`max(${schema.productRatingFacts.observedAt})`,
      })
      .from(schema.productRatingFacts)
      .groupBy(schema.productRatingFacts.productId);

    const [totalRow] = await app.db.select({ n: count() }).from(schema.productsMaster);
    const totalProducts = Number(totalRow?.n ?? 0);

    const bucket = (rows: Array<{ productId: string; latest: string }>) => {
      let fresh7 = 0;
      let fresh30 = 0;
      let stale = 0;
      const staleList: Array<{ productId: string; latestObservedAt: string }> = [];
      for (const row of rows) {
        const at = new Date(row.latest).getTime();
        if (at >= cutoff7.getTime()) fresh7 += 1;
        if (at >= cutoff30.getTime()) fresh30 += 1;
        else {
          stale += 1;
          if (staleList.length < 20) {
            staleList.push({ productId: row.productId, latestObservedAt: row.latest });
          }
        }
      }
      return {
        productsWithFacts: rows.length,
        productsWithoutFacts: totalProducts - rows.length,
        freshWithin7Days: fresh7,
        freshWithin30Days: fresh30,
        staleProducts: stale,
        staleSample: staleList,
      };
    };

    return {
      staleThresholdDays: STALE_FACT_DAYS,
      totalProducts,
      price: bucket(latestPrice),
      rating: bucket(latestRating),
    };
  });

  app.get("/coverage/stats", async () => {
    const [totalRow] = await app.db.select({ n: count() }).from(schema.productsMaster);
    const totalProducts = Number(totalRow?.n ?? 0);

    const distinctCount = async (table: typeof schema.productPriceFacts) => {
      const [row] = await app.db
        .select({ n: sql<number>`count(distinct ${table.productId})` })
        .from(table);
      return Number(row?.n ?? 0);
    };
    const withPrice = await distinctCount(schema.productPriceFacts);
    const withRating = await distinctCount(
      schema.productRatingFacts as unknown as typeof schema.productPriceFacts,
    );

    const bySource = await app.db
      .select({
        sourceSlug: schema.productPriceFacts.sourceSlug,
        priceFacts: count(),
        products: sql<number>`count(distinct ${schema.productPriceFacts.productId})`,
      })
      .from(schema.productPriceFacts)
      .groupBy(schema.productPriceFacts.sourceSlug);

    const byMarket = await app.db
      .select({
        marketName: sql<string | null>`${schema.markets.name}`,
        marketCode: sql<string | null>`${schema.markets.code}`,
        priceFacts: count(),
      })
      .from(schema.productPriceFacts)
      .leftJoin(schema.markets, eq(schema.productPriceFacts.marketId, schema.markets.id))
      .groupBy(schema.markets.name, schema.markets.code);

    const unmappedSources = await app.db
      .select({ slug: schema.sources.slug, name: schema.sources.name })
      .from(schema.sources)
      .where(
        notExists(
          app.db
            .select({ one: sql`1` })
            .from(schema.sourceMarkets)
            .where(eq(schema.sourceMarkets.sourceId, schema.sources.id)),
        ),
      );

    const [unmappedFactsRow] = await app.db
      .select({ n: count() })
      .from(schema.productPriceFacts)
      .where(isNull(schema.productPriceFacts.marketId));

    return {
      productCoverage: {
        totalProducts,
        withPriceFacts: withPrice,
        withRatingFacts: withRating,
        priceCoveragePct: totalProducts > 0 ? Math.round((withPrice / totalProducts) * 100) : 0,
        ratingCoveragePct: totalProducts > 0 ? Math.round((withRating / totalProducts) * 100) : 0,
      },
      bySource,
      byMarket: byMarket.map((row) => ({
        market: row.marketName ?? "(unmapped)",
        code: row.marketCode,
        priceFacts: Number(row.priceFacts),
      })),
      unmappedSources,
      priceFactsWithoutMarket: Number(unmappedFactsRow?.n ?? 0),
    };
  });

  app.get<{ Params: { id: string } }>("/sources/:id/health", async (request, reply) => {
    const source = await loadSource(app, request.params.id, reply);
    if (!source) return;

    const [jobStats] = await app.db
      .select({
        total: count(),
        succeeded: sql<number>`count(*) filter (where ${schema.crawlJobs.status} = 'succeeded')`,
        failed: sql<number>`count(*) filter (where ${schema.crawlJobs.status} = 'failed')`,
      })
      .from(schema.crawlJobs)
      .where(eq(schema.crawlJobs.sourceId, source.id));
    const [lastJob] = await app.db
      .select({
        id: schema.crawlJobs.id,
        status: schema.crawlJobs.status,
        finishedAt: schema.crawlJobs.finishedAt,
      })
      .from(schema.crawlJobs)
      .where(eq(schema.crawlJobs.sourceId, source.id))
      .orderBy(desc(schema.crawlJobs.createdAt))
      .limit(1);

    const [rawDocs] = await app.db
      .select({ n: count() })
      .from(schema.rawDocuments)
      .where(eq(schema.rawDocuments.sourceId, source.id));
    const factStats = async (table: typeof schema.productPriceFacts) => {
      const [row] = await app.db
        .select({ n: count(), latest: sql<string | null>`max(${table.observedAt})` })
        .from(table)
        .where(eq(table.sourceId, source.id));
      return { count: Number(row?.n ?? 0), lastObservedAt: row?.latest ?? null };
    };

    const mappings = await app.db
      .select({
        marketName: schema.markets.name,
        marketCode: schema.markets.code,
        confidence: schema.sourceMarkets.confidence,
      })
      .from(schema.sourceMarkets)
      .innerJoin(schema.markets, eq(schema.sourceMarkets.marketId, schema.markets.id))
      .where(eq(schema.sourceMarkets.sourceId, source.id));

    const total = Number(jobStats?.total ?? 0);
    return {
      source: { id: source.id, slug: source.slug, name: source.name, enabled: source.enabled },
      crawl: {
        totalJobs: total,
        succeeded: Number(jobStats?.succeeded ?? 0),
        failed: Number(jobStats?.failed ?? 0),
        successRate:
          total > 0 ? Math.round((Number(jobStats?.succeeded ?? 0) / total) * 100) : null,
        lastJob: lastJob ?? null,
      },
      rawDocuments: Number(rawDocs?.n ?? 0),
      priceFacts: await factStats(schema.productPriceFacts),
      ratingFacts: await factStats(
        schema.productRatingFacts as unknown as typeof schema.productPriceFacts,
      ),
      markets: mappings,
    };
  });

  app.get<{ Params: { id: string } }>("/sources/:id/coverage", async (request, reply) => {
    const source = await loadSource(app, request.params.id, reply);
    if (!source) return;

    const [productsLinked] = await app.db
      .select({ n: count() })
      .from(schema.productSources)
      .where(eq(schema.productSources.sourceId, source.id));
    const factCount = async (table: typeof schema.productPriceFacts) => {
      const [row] = await app.db
        .select({ n: count() })
        .from(table)
        .where(eq(table.sourceId, source.id));
      return Number(row?.n ?? 0);
    };
    const categories = await app.db
      .selectDistinct({ category: schema.productSearchDocuments.categoryName })
      .from(schema.productSources)
      .innerJoin(
        schema.productSearchDocuments,
        eq(schema.productSources.productId, schema.productSearchDocuments.productId),
      )
      .where(eq(schema.productSources.sourceId, source.id));

    return {
      source: { id: source.id, slug: source.slug, name: source.name },
      productsLinked: Number(productsLinked?.n ?? 0),
      priceFacts: await factCount(schema.productPriceFacts),
      ratingFacts: await factCount(
        schema.productRatingFacts as unknown as typeof schema.productPriceFacts,
      ),
      categories: categories.map((row) => row.category).filter(Boolean),
    };
  });
}

async function loadSource(
  app: FastifyInstance,
  id: string,
  reply: { status(code: number): { send(body: unknown): unknown } },
) {
  if (!UUID_PATTERN.test(id)) {
    reply.status(400).send({ error: "source id must be a UUID" });
    return null;
  }
  const [source] = await app.db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.id, id))
    .limit(1);
  if (!source) {
    reply.status(404).send({ error: "source not found" });
    return null;
  }
  return source;
}
