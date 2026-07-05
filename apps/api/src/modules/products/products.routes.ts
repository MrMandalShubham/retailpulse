import type { FastifyInstance } from "fastify";
import { and, asc, count, desc, eq, gte, ilike, lte, schema, sql } from "@dip/db";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SORTS = ["newest", "price_asc", "price_desc", "rating", "confidence", "relevance"] as const;
type Sort = (typeof SORTS)[number];

interface ListQuery {
  brandId?: string;
  categoryId?: string;
  sourceSlug?: string;
  minPrice?: string;
  maxPrice?: string;
  minRating?: string;
  sort?: string;
  limit?: string;
  offset?: string;
}

/**
 * Canonical product catalog — read-only. Backed by products_master plus the
 * product_search_documents projection (kept transactionally in sync by the
 * promotion gateway), so filters and sorts stay on indexed columns.
 */
export async function productsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ListQuery & { q?: string } }>("/products", async (request, reply) => {
    const parsed = parseListQuery(request.query);
    if ("error" in parsed) return badRequest(reply, parsed.error);
    const { conditions, order, limit, offset } = parsed;

    const rows = await app.db
      .select({
        product: schema.productsMaster,
        doc: schema.productSearchDocuments,
      })
      .from(schema.productsMaster)
      .leftJoin(
        schema.productSearchDocuments,
        eq(schema.productSearchDocuments.productId, schema.productsMaster.id),
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(...order)
      .limit(limit)
      .offset(offset);

    const [total] = await app.db
      .select({ n: count() })
      .from(schema.productsMaster)
      .leftJoin(
        schema.productSearchDocuments,
        eq(schema.productSearchDocuments.productId, schema.productsMaster.id),
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return {
      total: Number(total?.n ?? 0),
      limit,
      offset,
      products: rows.map(toListItem),
    };
  });

  app.get<{ Querystring: ListQuery & { q?: string } }>(
    "/products/search",
    async (request, reply) => {
      const q = request.query.q?.trim();
      if (!q) return badRequest(reply, "query parameter 'q' is required");
      const parsed = parseListQuery(request.query);
      if ("error" in parsed) return badRequest(reply, parsed.error);
      const { conditions, limit, offset } = parsed;

      // FTS for real queries; prefix ILIKE fallback for very short input.
      const rank = sql<number>`ts_rank(${schema.productSearchDocuments.searchVector}, websearch_to_tsquery('english', ${q}))`;
      if (q.length >= 3) {
        conditions.push(
          sql`${schema.productSearchDocuments.searchVector} @@ websearch_to_tsquery('english', ${q})`,
        );
      } else {
        conditions.push(ilike(schema.productSearchDocuments.searchText, `%${q}%`));
      }

      const rows = await app.db
        .select({
          product: schema.productsMaster,
          doc: schema.productSearchDocuments,
          rank,
        })
        .from(schema.productsMaster)
        .innerJoin(
          schema.productSearchDocuments,
          eq(schema.productSearchDocuments.productId, schema.productsMaster.id),
        )
        .where(and(...conditions))
        .orderBy(desc(rank), desc(schema.productsMaster.createdAt))
        .limit(limit)
        .offset(offset);

      return { query: q, limit, offset, products: rows.map(toListItem) };
    },
  );

  app.get("/products/stats", async () => {
    const [products, brands, categories, productTypes, sources, media, docs] = await Promise.all([
      countAll(app, schema.productsMaster),
      countAll(app, schema.brands),
      countAll(app, schema.categories),
      countAll(app, schema.productTypes),
      countAll(app, schema.productSources),
      countAll(app, schema.productMedia),
      countAll(app, schema.productSearchDocuments),
    ]);
    const byBrand = await app.db
      .select({ brandName: schema.productSearchDocuments.brandName, n: count() })
      .from(schema.productSearchDocuments)
      .groupBy(schema.productSearchDocuments.brandName)
      .orderBy(desc(count()))
      .limit(10);
    const byCategory = await app.db
      .select({ categoryName: schema.productSearchDocuments.categoryName, n: count() })
      .from(schema.productSearchDocuments)
      .groupBy(schema.productSearchDocuments.categoryName)
      .orderBy(desc(count()))
      .limit(10);
    const [latestRun] = await app.db
      .select()
      .from(schema.promotionRuns)
      .orderBy(desc(schema.promotionRuns.createdAt))
      .limit(1);

    return {
      totals: { products, brands, categories, productTypes, sources, media, searchDocuments: docs },
      byBrand: byBrand.map((r) => ({ brand: r.brandName, count: Number(r.n) })),
      byCategory: byCategory.map((r) => ({ category: r.categoryName, count: Number(r.n) })),
      latestPromotionRun: latestRun ?? null,
    };
  });

  app.get<{ Params: { id: string } }>("/products/:id", async (request, reply) => {
    const product = await loadProduct(app, request.params.id, reply);
    if (!product) return;
    const [sources, media, doc] = await Promise.all([
      app.db
        .select()
        .from(schema.productSources)
        .where(eq(schema.productSources.productId, product.product.id)),
      app.db
        .select()
        .from(schema.productMedia)
        .where(eq(schema.productMedia.productId, product.product.id))
        .orderBy(asc(schema.productMedia.position)),
      app.db
        .select()
        .from(schema.productSearchDocuments)
        .where(eq(schema.productSearchDocuments.productId, product.product.id))
        .limit(1),
    ]);
    return { ...product, sources, media, searchDocument: doc[0] ?? null };
  });

  app.get<{ Params: { id: string } }>("/products/:id/sources", async (request, reply) => {
    const product = await loadProduct(app, request.params.id, reply);
    if (!product) return;
    const sources = await app.db
      .select()
      .from(schema.productSources)
      .where(eq(schema.productSources.productId, product.product.id))
      .orderBy(desc(schema.productSources.lastPromotedAt));
    return { productId: product.product.id, sources };
  });

  app.get<{ Params: { id: string } }>("/products/:id/media", async (request, reply) => {
    const product = await loadProduct(app, request.params.id, reply);
    if (!product) return;
    const media = await app.db
      .select()
      .from(schema.productMedia)
      .where(eq(schema.productMedia.productId, product.product.id))
      .orderBy(asc(schema.productMedia.position));
    return { productId: product.product.id, media };
  });

  app.get<{ Params: { id: string } }>("/products/:id/history", async (request, reply) => {
    const product = await loadProduct(app, request.params.id, reply);
    if (!product) return;
    const history = await app.db
      .select({
        item: schema.promotionItems,
        run: {
          id: schema.promotionRuns.id,
          triggerType: schema.promotionRuns.triggerType,
          status: schema.promotionRuns.status,
        },
      })
      .from(schema.promotionItems)
      .innerJoin(
        schema.promotionRuns,
        eq(schema.promotionItems.promotionRunId, schema.promotionRuns.id),
      )
      .where(eq(schema.promotionItems.productId, product.product.id))
      .orderBy(desc(schema.promotionItems.createdAt));
    return { productId: product.product.id, history };
  });
}

async function loadProduct(
  app: FastifyInstance,
  id: string,
  reply: { status(code: number): { send(body: unknown): unknown } },
) {
  if (!UUID_PATTERN.test(id)) {
    reply.status(400).send({ error: "product id must be a UUID" });
    return null;
  }
  const [row] = await app.db
    .select({
      product: schema.productsMaster,
      brand: { id: schema.brands.id, name: schema.brands.name, slug: schema.brands.slug },
      category: { id: schema.categories.id, name: schema.categories.name },
      productType: { id: schema.productTypes.id, name: schema.productTypes.name },
    })
    .from(schema.productsMaster)
    .leftJoin(schema.brands, eq(schema.productsMaster.brandId, schema.brands.id))
    .leftJoin(schema.categories, eq(schema.productsMaster.categoryId, schema.categories.id))
    .leftJoin(schema.productTypes, eq(schema.productsMaster.productTypeId, schema.productTypes.id))
    .where(eq(schema.productsMaster.id, id))
    .limit(1);
  if (!row) {
    reply.status(404).send({ error: "product not found" });
    return null;
  }
  return row;
}

function parseListQuery(query: ListQuery):
  | {
      conditions: ReturnType<typeof sql>[];
      order: ReturnType<typeof desc>[];
      limit: number;
      offset: number;
    }
  | { error: string } {
  const limit = Number.parseInt(query.limit ?? "20", 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { error: "limit must be an integer between 1 and 100" };
  }
  const offset = Number.parseInt(query.offset ?? "0", 10);
  if (!Number.isInteger(offset) || offset < 0) {
    return { error: "offset must be a non-negative integer" };
  }
  const sort = (query.sort ?? "newest") as Sort;
  if (!SORTS.includes(sort)) {
    return { error: `sort must be one of: ${SORTS.join(", ")}` };
  }

  const conditions: ReturnType<typeof sql>[] = [];
  for (const [key, value] of [
    ["brandId", query.brandId],
    ["categoryId", query.categoryId],
  ] as const) {
    if (value !== undefined) {
      if (!UUID_PATTERN.test(value)) return { error: `${key} must be a UUID` };
      conditions.push(
        key === "brandId"
          ? (eq(schema.productsMaster.brandId, value) as never)
          : (eq(schema.productsMaster.categoryId, value) as never),
      );
    }
  }
  if (query.sourceSlug) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${schema.productSources} WHERE ${schema.productSources.productId} = ${schema.productsMaster.id} AND ${schema.productSources.sourceSlug} = ${query.sourceSlug})`,
    );
  }
  for (const [name, raw, column, cmp] of [
    ["minPrice", query.minPrice, schema.productSearchDocuments.priceValue, gte],
    ["maxPrice", query.maxPrice, schema.productSearchDocuments.priceValue, lte],
    ["minRating", query.minRating, schema.productSearchDocuments.rating, gte],
  ] as const) {
    if (raw !== undefined) {
      const value = Number.parseFloat(raw);
      if (!Number.isFinite(value) || value < 0)
        return { error: `${name} must be a non-negative number` };
      conditions.push(cmp(column, value.toString()) as never);
    }
  }

  const orderMap: Record<Sort, ReturnType<typeof desc>[]> = {
    newest: [desc(schema.productsMaster.createdAt)],
    price_asc: [asc(schema.productSearchDocuments.priceValue) as never],
    price_desc: [desc(schema.productSearchDocuments.priceValue)],
    rating: [desc(schema.productSearchDocuments.rating)],
    confidence: [desc(schema.productsMaster.dataQualityScore)],
    relevance: [desc(schema.productsMaster.createdAt)], // meaningful only under /search
  };
  return { conditions, order: orderMap[sort], limit, offset };
}

function toListItem(row: {
  product: typeof schema.productsMaster.$inferSelect;
  doc: typeof schema.productSearchDocuments.$inferSelect | null;
}) {
  return {
    id: row.product.id,
    slug: row.product.slug,
    name: row.product.name,
    brand: row.doc?.brandName ?? null,
    category: row.doc?.categoryName ?? null,
    productType: row.doc?.productTypeName ?? null,
    price: row.doc?.priceValue !== null && row.doc !== null ? Number(row.doc.priceValue) : null,
    currency: row.doc?.priceCurrency ?? null,
    rating: row.doc?.rating !== null && row.doc !== null ? Number(row.doc.rating) : null,
    primaryImageUrl: row.product.primaryImageUrl,
    dataQualityScore:
      row.product.dataQualityScore !== null ? Number(row.product.dataQualityScore) : null,
    verified: row.product.verified,
    createdAt: row.product.createdAt,
  };
}

async function countAll(app: FastifyInstance, table: unknown): Promise<number> {
  // Structural cast: every schema table works with a bare COUNT(*) select.
  const rows = await app.db.select({ n: count() }).from(table as typeof schema.productsMaster);
  return Number(rows[0]?.n ?? 0);
}

function badRequest(
  reply: { status(code: number): { send(body: unknown): unknown } },
  error: string,
) {
  return reply.status(400).send({ error });
}
