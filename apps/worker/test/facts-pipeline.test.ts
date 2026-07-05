/**
 * Fact pipeline integration against a real migrated Postgres
 * (TEST_DATABASE_URL; skipped otherwise). Builds its own fixture chain with a
 * mapped source (confirmed) and an unmapped source, runs the REAL pipeline +
 * repo, and cleans up everything it created.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, createDb, eq, inArray, schema, type DbConnection } from "@dip/db";
import { runFactCycle } from "../src/facts/pipeline.js";
import { createFactRepo } from "../src/facts/repo.js";
import { periodMonth, weekEnding } from "../src/facts/validate.js";

const testDbUrl = process.env.TEST_DATABASE_URL;
const tag = randomUUID().slice(0, 8);
const silentLogger = { info() {}, warn() {}, error() {} };

describe.skipIf(!testDbUrl)("fact pipeline (integration)", () => {
  let conn: DbConnection;
  let repo: ReturnType<typeof createFactRepo>;
  let marketId: string;
  let mappedSourceId: string;
  let unmappedSourceId: string;
  let brandId: string;
  let productAId: string;
  let productBId: string;
  let crawlJobA: string;
  let crawlJobB: string;
  let transformRunId: string;
  let promotionRunId: string;
  const factRunIds: string[] = [];

  async function runCycle() {
    const summary = await runFactCycle({ repo, logger: silentLogger, maxProducts: 500 });
    if (summary.runId) factRunIds.push(summary.runId);
    return summary;
  }

  beforeAll(async () => {
    conn = createDb(testDbUrl as string);
    repo = createFactRepo(conn.db);
    const { db } = conn;

    const [market] = await db
      .insert(schema.markets)
      .values({ name: `Fact Test Market ${tag}`, code: "XT", region: "Test" })
      .onConflictDoNothing({ target: schema.markets.code })
      .returning({ id: schema.markets.id });
    marketId =
      market?.id ??
      (
        await db
          .select({ id: schema.markets.id })
          .from(schema.markets)
          .where(eq(schema.markets.code, "XT"))
      )[0]!.id;

    const mkSource = async (slug: string) => {
      const [row] = await db
        .insert(schema.sources)
        .values({
          name: slug,
          slug,
          baseUrl: `https://${slug}.example/`,
          sourceType: "website",
          enabled: false,
        })
        .returning({ id: schema.sources.id });
      return row!.id;
    };
    mappedSourceId = await mkSource(`fact-mapped-${tag}`);
    unmappedSourceId = await mkSource(`fact-unmapped-${tag}`);

    await db.insert(schema.sourceMarkets).values({
      sourceId: mappedSourceId,
      marketId,
      confidence: "confirmed",
      notes: "test mapping",
    });

    const [brand] = await db
      .insert(schema.brands)
      .values({ name: `FactBrand ${tag}`, slug: `factbrand-${tag}` })
      .returning({ id: schema.brands.id });
    brandId = brand!.id;
    const mkProduct = async (suffix: string) => {
      const [row] = await db
        .insert(schema.productsMaster)
        .values({
          name: `Fact Product ${suffix} ${tag}`,
          slug: `fact-product-${suffix}-${tag}`,
          brandId,
        })
        .returning({ id: schema.productsMaster.id });
      return row!.id;
    };
    productAId = await mkProduct("a");
    productBId = await mkProduct("b");

    const mkJob = async (sourceId: string) => {
      const [row] = await db
        .insert(schema.crawlJobs)
        .values({ sourceId, status: "succeeded" })
        .returning({ id: schema.crawlJobs.id });
      return row!.id;
    };
    crawlJobA = await mkJob(mappedSourceId);
    crawlJobB = await mkJob(unmappedSourceId);

    const [tRun] = await db
      .insert(schema.transformRuns)
      .values({ status: "succeeded" })
      .returning({ id: schema.transformRuns.id });
    transformRunId = tRun!.id;
    const [pRun] = await db
      .insert(schema.promotionRuns)
      .values({ status: "succeeded", triggerType: "batch" })
      .returning({ id: schema.promotionRuns.id });
    promotionRunId = pRun!.id;
  });

  afterAll(async () => {
    const { db } = conn;
    const productIds = [productAId, productBId];
    // product_markets and the two V1 core fact tables reference products_master
    // WITHOUT ON DELETE CASCADE (Phase 1 design) — remove them first.
    await db.delete(schema.retailPulsePrices).where(inArray(schema.retailPulsePrices.productId, productIds));
    await db.delete(schema.voicePulseReviews).where(inArray(schema.voicePulseReviews.productId, productIds));
    await db.delete(schema.productMarkets).where(inArray(schema.productMarkets.productId, productIds));
    // product_price_facts / product_rating_facts DO cascade with products.
    await db.delete(schema.productsMaster).where(inArray(schema.productsMaster.id, productIds));
    await db.delete(schema.brands).where(eq(schema.brands.id, brandId));
    await db
      .delete(schema.sources)
      .where(inArray(schema.sources.id, [mappedSourceId, unmappedSourceId]));
    await db.delete(schema.promotionRuns).where(eq(schema.promotionRuns.id, promotionRunId));
    await db.delete(schema.transformRuns).where(eq(schema.transformRuns.id, transformRunId));
    if (factRunIds.length > 0) {
      await db.delete(schema.factRuns).where(inArray(schema.factRuns.id, factRunIds));
    }
    await db.delete(schema.markets).where(eq(schema.markets.code, "XT"));
    await conn.pool.end();
  });

  /** Full evidence chain: raw doc -> staged -> promotion item. */
  async function makeEvidence(input: {
    productId: string;
    sourceId: string;
    crawlJobId: string;
    url: string;
    fetchedAt: Date;
    price?: { value: number; currency: string } | null;
    rating?: { value: number; reviewCount: number } | null;
  }): Promise<string> {
    const { db } = conn;
    const [doc] = await db
      .insert(schema.rawDocuments)
      .values({
        crawlJobId: input.crawlJobId,
        sourceId: input.sourceId,
        url: input.url,
        status: "ok",
        contentType: "text/html",
        storageKey: `raw/fact-test/${randomUUID().slice(0, 8)}.html`,
        fetchedAt: input.fetchedAt,
      })
      .returning({ id: schema.rawDocuments.id });
    const [staged] = await db
      .insert(schema.stagedProducts)
      .values({
        transformRunId,
        rawDocumentId: doc!.id,
        sourceId: input.sourceId,
        sourceUrl: input.url,
        pageType: "product",
        extractedName: `Fact Product ${tag}`,
        extractedBrand: `FactBrand ${tag}`,
        extractedPriceText: input.price ? `$${input.price.value}` : null,
        extractedRatingText: input.rating ? `${input.rating.value}/5` : null,
        confidenceScore: "0.900",
        validationStatus: "valid",
        normalizedPayload: {
          price: input.price ?? null,
          rating: input.rating
            ? { value: input.rating.value, reviewCount: input.rating.reviewCount }
            : null,
        },
      })
      .returning({ id: schema.stagedProducts.id });
    await db.insert(schema.promotionItems).values({
      promotionRunId,
      stagedProductId: staged!.id,
      sourceId: input.sourceId,
      productId: input.productId,
      decision: "promoted_new",
    });
    return staged!.id;
  }

  // Both anchored safely in the past, same calendar month, different ISO weeks
  // (the pipeline rejects future observed_at, so these must not drift ahead of
  // the test's wall clock).
  const T1 = new Date("2026-06-08T08:00:00Z");
  const T2 = new Date("2026-06-16T08:00:00Z");

  it("extracts facts with market stamping, currency uppercasing, rollups, and product_markets", async () => {
    await makeEvidence({
      productId: productAId,
      sourceId: mappedSourceId,
      crawlJobId: crawlJobA,
      url: `https://fact-mapped-${tag}.example/product/a`,
      fetchedAt: T1,
      price: { value: 19.5, currency: "usd" }, // lowercase on purpose
      rating: { value: 4.2, reviewCount: 120 },
    });
    await makeEvidence({
      productId: productBId,
      sourceId: unmappedSourceId,
      crawlJobId: crawlJobB,
      url: `https://fact-unmapped-${tag}.example/product/b`,
      fetchedAt: T1,
      price: { value: 8, currency: "EUR" },
      rating: null,
    });

    const summary = await runCycle();
    expect(summary.priceFactsInserted).toBeGreaterThanOrEqual(2);
    expect(summary.ratingFactsInserted).toBeGreaterThanOrEqual(1);

    const { db } = conn;
    const [factA] = await db
      .select()
      .from(schema.productPriceFacts)
      .where(eq(schema.productPriceFacts.productId, productAId));
    expect(factA?.marketId).toBe(marketId); // mapped source stamps market
    expect(factA?.priceCurrency).toBe("USD"); // uppercased
    expect(factA?.factType).toBe("observed");

    const [factB] = await db
      .select()
      .from(schema.productPriceFacts)
      .where(eq(schema.productPriceFacts.productId, productBId));
    expect(factB?.marketId).toBeNull(); // unmapped source: honestly unknown

    // Core rollups ONLY for the mapped source.
    const rollupsA = await db
      .select()
      .from(schema.retailPulsePrices)
      .where(eq(schema.retailPulsePrices.productId, productAId));
    expect(rollupsA).toHaveLength(1);
    expect(rollupsA[0]?.weekEnding).toBe(weekEnding(T1));
    const rollupsB = await db
      .select()
      .from(schema.retailPulsePrices)
      .where(eq(schema.retailPulsePrices.productId, productBId));
    expect(rollupsB).toHaveLength(0);

    const ratingRollups = await db
      .select()
      .from(schema.voicePulseReviews)
      .where(eq(schema.voicePulseReviews.productId, productAId));
    expect(ratingRollups).toHaveLength(1);
    expect(ratingRollups[0]?.periodMonth).toBe(periodMonth(T1));

    // product_markets upsert only for confirmed mapping.
    const pmA = await db
      .select()
      .from(schema.productMarkets)
      .where(eq(schema.productMarkets.productId, productAId));
    expect(pmA).toHaveLength(1);
    expect(pmA[0]?.status).toBe("Active");
    const pmB = await db
      .select()
      .from(schema.productMarkets)
      .where(eq(schema.productMarkets.productId, productBId));
    expect(pmB).toHaveLength(0);
  });

  it("re-running is a structural no-op (dedup anchor)", async () => {
    const before = await countFacts(productAId);
    const summary = await runCycle();
    expect(summary.duplicatesSkipped).toBeGreaterThanOrEqual(2);
    expect(await countFacts(productAId)).toBe(before);
  });

  it("a later observation APPENDS history; same-month rating rollup keeps first observation", async () => {
    await makeEvidence({
      productId: productAId,
      sourceId: mappedSourceId,
      crawlJobId: crawlJobA,
      url: `https://fact-mapped-${tag}.example/product/a`,
      fetchedAt: T2,
      price: { value: 17.99, currency: "USD" }, // price drop a week later
      rating: { value: 4.3, reviewCount: 150 },
    });
    const summary = await runCycle();
    expect(summary.priceFactsInserted).toBeGreaterThanOrEqual(1);
    expect(summary.ratingFactsInserted).toBeGreaterThanOrEqual(1);

    const { db } = conn;
    const timeline = await db
      .select()
      .from(schema.productPriceFacts)
      .where(eq(schema.productPriceFacts.productId, productAId));
    expect(timeline).toHaveLength(2); // history preserved, nothing overwritten

    // New ISO week -> second price rollup; same month -> rating rollup unchanged.
    const priceRollups = await db
      .select()
      .from(schema.retailPulsePrices)
      .where(eq(schema.retailPulsePrices.productId, productAId));
    expect(priceRollups).toHaveLength(2);
    const ratingRollups = await db
      .select()
      .from(schema.voicePulseReviews)
      .where(eq(schema.voicePulseReviews.productId, productAId));
    expect(ratingRollups).toHaveLength(1);
    expect(ratingRollups[0]?.avgRating).toBe("4.20"); // first observation of the period wins
  });

  it("rejects invalid candidates without polluting the fact layer", async () => {
    await makeEvidence({
      productId: productBId,
      sourceId: unmappedSourceId,
      crawlJobId: crawlJobB,
      url: `https://fact-unmapped-${tag}.example/product/bad`,
      fetchedAt: T2,
      price: { value: 12, currency: "EURO" }, // invalid currency code
      rating: null,
    });
    const summary = await runCycle();
    expect(summary.skippedInvalid).toBeGreaterThanOrEqual(1);

    const { db } = conn;
    const facts = await db
      .select()
      .from(schema.productPriceFacts)
      .where(
        and(
          eq(schema.productPriceFacts.productId, productBId),
          eq(schema.productPriceFacts.priceCurrency, "EURO"),
        ),
      );
    expect(facts).toHaveLength(0);
  });

  async function countFacts(productId: string): Promise<number> {
    const rows = await conn.db
      .select()
      .from(schema.productPriceFacts)
      .where(eq(schema.productPriceFacts.productId, productId));
    return rows.length;
  }
});
