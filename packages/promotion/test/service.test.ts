/**
 * Transactional promotion flow against a real migrated Postgres
 * (TEST_DATABASE_URL; skipped otherwise). Builds its own fixture chain
 * (source -> crawl_job -> raw_document -> transform_run -> staged rows),
 * uses promoteSingle/reject only (never batch — the shared dev DB may hold
 * real staged rows), and cleans up everything it created.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, eq, inArray, schema, type DbConnection } from "@dip/db";
import { createPromotionService, normalizeSourceUrl } from "../src/index.js";

const testDbUrl = process.env.TEST_DATABASE_URL;
const tag = randomUUID().slice(0, 8);
const BRAND = `PromoTestBrand ${tag}`;

describe.skipIf(!testDbUrl)("promotion service (integration)", () => {
  let conn: DbConnection;
  let service: ReturnType<typeof createPromotionService>;
  let sourceId: string;
  let crawlJobId: string;
  let transformRunId: string;
  const rawDocIds: string[] = [];
  const stagedIds: Record<string, string> = {};
  const runIds: string[] = [];

  const baseUrl = `https://promo-test-${tag}.example/product/essence-100ml`;

  beforeAll(async () => {
    conn = createDb(testDbUrl as string);
    service = createPromotionService(conn.db);
    const { db } = conn;

    const [source] = await db
      .insert(schema.sources)
      .values({
        name: `Promo Test Source ${tag}`,
        slug: `promo-test-${tag}`,
        baseUrl: `https://promo-test-${tag}.example/`,
        sourceType: "website",
        enabled: false,
      })
      .returning({ id: schema.sources.id });
    sourceId = source!.id;

    const [job] = await db
      .insert(schema.crawlJobs)
      .values({ sourceId, status: "succeeded" })
      .returning({ id: schema.crawlJobs.id });
    crawlJobId = job!.id;

    const [run] = await db
      .insert(schema.transformRuns)
      .values({ status: "succeeded", sourceId })
      .returning({ id: schema.transformRuns.id });
    transformRunId = run!.id;
  });

  afterAll(async () => {
    const { db } = conn;
    // Products created by these tests (cascade removes sources/media/search docs).
    const brands = await db
      .select({ id: schema.brands.id })
      .from(schema.brands)
      .where(eq(schema.brands.name, BRAND));
    for (const brand of brands) {
      await db.delete(schema.productsMaster).where(eq(schema.productsMaster.brandId, brand.id));
      await db.delete(schema.brands).where(eq(schema.brands.id, brand.id));
    }
    // slugify("PromoCat <tag>") -> "promocat-<tag>"; product_types cascade is
    // not defined on categories, so remove types created under it first.
    const cats = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.slug, `promocat-${tag}`));
    for (const cat of cats) {
      await db.delete(schema.productTypes).where(eq(schema.productTypes.categoryId, cat.id));
      await db.delete(schema.categories).where(eq(schema.categories.id, cat.id));
    }
    if (runIds.length > 0) {
      await db.delete(schema.promotionRuns).where(inArray(schema.promotionRuns.id, runIds));
    }
    // Source cascade removes crawl job, raw docs, staged rows.
    await db.delete(schema.sources).where(eq(schema.sources.id, sourceId));
    await db.delete(schema.transformRuns).where(eq(schema.transformRuns.id, transformRunId));
    await conn.pool.end();
  });

  async function makeStaged(input: {
    key: string;
    name: string;
    url: string;
    confidence?: string;
    validationStatus?: string;
    unresolved?: string[];
  }): Promise<string> {
    const { db } = conn;
    const [doc] = await db
      .insert(schema.rawDocuments)
      .values({
        crawlJobId,
        sourceId,
        url: input.url,
        status: "ok",
        contentType: "text/html",
        storageKey: `raw/promo-test-${tag}/${input.key}.html`,
        fetchedAt: new Date(),
      })
      .returning({ id: schema.rawDocuments.id });
    rawDocIds.push(doc!.id);

    const [staged] = await db
      .insert(schema.stagedProducts)
      .values({
        transformRunId,
        rawDocumentId: doc!.id,
        sourceId,
        sourceUrl: input.url,
        pageType: "product",
        dominantSignal: "jsonld_product",
        extractedName: input.name,
        extractedBrand: BRAND,
        extractedCategory: `PromoCat ${tag}`,
        extractedProductType: "Essence",
        extractedDescription: "test description",
        extractedCurrency: "USD",
        extractedPriceText: "$21.99",
        primaryImageUrl: "https://img.example/essence.jpg",
        extractionMethod: "jsonld",
        confidenceScore: input.confidence ?? "0.900",
        validationStatus: input.validationStatus ?? "valid",
        normalizedPayload: {
          price: { value: 21.99, currency: "USD" },
          rating: { value: 4.6 },
          image: "https://img.example/essence.jpg",
        },
        unresolvedFields: input.unresolved ?? [],
        aiRecommended: false,
      })
      .returning({ id: schema.stagedProducts.id });
    stagedIds[input.key] = staged!.id;
    return staged!.id;
  }

  it("promotes an eligible staged product into canonical tables with full provenance", async () => {
    const stagedId = await makeStaged({
      key: "a",
      name: `Snail Essence ${tag} 100ml`,
      url: baseUrl,
    });
    const summary = await service.promoteSingle(stagedId, "initial promotion");
    if (summary.runId) runIds.push(summary.runId);

    expect(summary.promotedNew).toBe(1);
    const outcome = summary.outcomes[0]!;
    expect(outcome.decision).toBe("promoted_new");
    expect(outcome.matchStrategy).toBe("new_product");
    const productId = outcome.productId as string;

    const { db } = conn;
    const [product] = await db
      .select()
      .from(schema.productsMaster)
      .where(eq(schema.productsMaster.id, productId));
    expect(product?.name).toBe(`Snail Essence ${tag} 100ml`);
    expect(product?.brandId).not.toBeNull();
    expect(product?.categoryId).not.toBeNull();
    expect(product?.productTypeId).not.toBeNull();
    expect(product?.priceBenchmarkUsd).toBe("21.99");
    expect(product?.verified).toBe(false);

    const [link] = await db
      .select()
      .from(schema.productSources)
      .where(eq(schema.productSources.productId, productId));
    expect(link?.sourceUrl).toBe(normalizeSourceUrl(baseUrl));
    expect(link?.stagedProductId).toBe(stagedId);

    const media = await db
      .select()
      .from(schema.productMedia)
      .where(eq(schema.productMedia.productId, productId));
    expect(media).toHaveLength(1);

    const [doc] = await db
      .select()
      .from(schema.productSearchDocuments)
      .where(eq(schema.productSearchDocuments.productId, productId));
    expect(doc?.searchText).toContain(BRAND);
    expect(doc?.rating).toBe("4.60");

    // Audit trail carries the operator note.
    const [item] = await db
      .select()
      .from(schema.promotionItems)
      .where(eq(schema.promotionItems.stagedProductId, stagedId));
    expect(item?.decision).toBe("promoted_new");
    expect(item?.operatorNote).toBe("initial promotion");
    expect(item?.productId).toBe(productId);
  });

  it("is idempotent: re-promoting the same staged row matches via source_url", async () => {
    const summary = await service.promoteSingle(stagedIds.a as string);
    if (summary.runId) runIds.push(summary.runId);
    expect(summary.matchedExisting).toBe(1);
    expect(summary.outcomes[0]?.matchStrategy).toBe("source_url");

    const { db } = conn;
    const brands = await db.select().from(schema.brands).where(eq(schema.brands.name, BRAND));
    const products = await db
      .select()
      .from(schema.productsMaster)
      .where(eq(schema.productsMaster.brandId, brands[0]!.id));
    expect(products).toHaveLength(1); // still exactly one canonical product
  });

  it("normalizes URL variants to the same product (tracking params, slash, case)", async () => {
    const variantUrl = `HTTPS://promo-test-${tag}.example/product/essence-100ml/?utm_source=mail&fbclid=zz`;
    const stagedId = await makeStaged({
      key: "b",
      name: `Snail Essence ${tag} 100ml`,
      url: variantUrl,
    });
    const summary = await service.promoteSingle(stagedId);
    if (summary.runId) runIds.push(summary.runId);
    expect(summary.outcomes[0]?.decision).toBe("matched_existing");
    expect(summary.outcomes[0]?.matchStrategy).toBe("source_url");
  });

  it("keeps ambiguous same-brand names staged instead of forcing a merge", async () => {
    const stagedId = await makeStaged({
      key: "c",
      name: `Snail Essence ${tag} 250ml`,
      url: `https://promo-test-${tag}.example/product/essence-250ml`,
    });
    const summary = await service.promoteSingle(stagedId);
    if (summary.runId) runIds.push(summary.runId);
    const outcome = summary.outcomes[0]!;
    expect(outcome.decision).toBe("skipped_ambiguous");
    expect(outcome.productId).toBeNull();
    expect(outcome.reasons.join(" ")).toContain("identity ambiguous");
  });

  it("refuses low-confidence records with recorded reasons", async () => {
    const stagedId = await makeStaged({
      key: "d",
      name: `Different Product ${tag}`,
      url: `https://promo-test-${tag}.example/product/other`,
      confidence: "0.500",
    });
    const summary = await service.promoteSingle(stagedId);
    if (summary.runId) runIds.push(summary.runId);
    const outcome = summary.outcomes[0]!;
    expect(outcome.decision).toBe("skipped_ineligible");
    expect(outcome.reasons.join(" ")).toContain("below 0.8");
  });

  it("reject requires audit note and makes the record permanently unpromotable", async () => {
    const stagedId = await makeStaged({
      key: "e",
      name: `Rejectable Product ${tag}`,
      url: `https://promo-test-${tag}.example/product/rejectable`,
    });
    const result = await service.reject(stagedId, "wrong catalog scope");
    expect(result.ok).toBe(true);

    const { db } = conn;
    const [item] = await db
      .select()
      .from(schema.promotionItems)
      .where(eq(schema.promotionItems.stagedProductId, stagedId));
    if (item) runIds.push(item.promotionRunId);
    expect(item?.decision).toBe("rejected");
    expect(item?.operatorNote).toBe("wrong catalog scope");

    const [staged] = await db
      .select()
      .from(schema.stagedProducts)
      .where(eq(schema.stagedProducts.id, stagedId));
    expect(staged?.validationStatus).toBe("invalid");
    expect(staged?.validationErrors?.join(" ")).toContain("operator rejected: wrong catalog scope");

    // A rejected record can never pass the gates again.
    const retry = await service.promoteSingle(stagedId);
    if (retry.runId) runIds.push(retry.runId);
    expect(retry.outcomes[0]?.decision).toBe("skipped_ineligible");
  });

  it("rejecting an unknown staged id fails cleanly", async () => {
    const result = await service.reject("00000000-0000-4000-8000-000000000000", "n/a");
    expect(result.ok).toBe(false);
  });
});
