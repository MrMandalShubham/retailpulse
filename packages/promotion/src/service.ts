import { and, desc, eq, notExists, schema, sql, type Db } from "@dip/db";
import {
  evaluatePromotionEligibility,
  type MatchStrategy,
  type PromotionDecision,
  type PromotionTriggerType,
} from "@dip/domain";
import { pickMatch } from "./matcher.js";
import { fold, slugify } from "./text.js";
import { normalizeSourceUrl } from "./url.js";

/**
 * @dip/promotion — the ONLY gateway that writes canonical product truth.
 *
 * Guarantees (approved design):
 * - eligibility-gated: valid + confident + product page + resolved identity
 * - transactional: each item is one transaction; partial writes cannot leak
 * - idempotent: normalized source_url uniqueness + item-level dedup make
 *   re-runs structurally unable to duplicate canonical rows
 * - auditable: every considered item leaves a promotion_items row with
 *   decision, reasons, match strategy/score, and operator notes
 * - conservative: matched products get fill-if-null enrichment only;
 *   ambiguous identity stays staged; fact tables are never written here
 */

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type StagedRow = typeof schema.stagedProducts.$inferSelect;

interface StagedCandidate {
  staged: StagedRow;
  sourceSlug: string | null;
}

export interface ItemOutcome {
  stagedProductId: string;
  decision: PromotionDecision;
  productId: string | null;
  matchStrategy: MatchStrategy | null;
  matchScore: number | null;
  reasons: string[];
}

export interface PromotionSummary {
  runId: string | null;
  totalItems: number;
  promotedNew: number;
  matchedExisting: number;
  skipped: number;
  failed: number;
  outcomes: ItemOutcome[];
}

interface StagedPayload {
  price: { value: number; currency: string | null } | null;
  rating: { value: number } | null;
  image: string | null;
  /** Source-native identifiers (api_json envelopes): GTIN + product number. */
  barcode: string | null;
  sku: string | null;
}

export interface PromotionService {
  /** Promote all eligible, not-yet-considered staged products (capped). */
  runBatch(maxItems: number): Promise<PromotionSummary>;
  /** Promote one staged product through the same gates. */
  promoteSingle(stagedProductId: string, operatorNote?: string): Promise<PromotionSummary>;
  /** Operator rejection: audit row + staged record becomes not promotable. */
  reject(stagedProductId: string, reason: string): Promise<{ ok: boolean; error?: string }>;
  /** Preview of promotable candidates (dashboard queue). */
  listQueue(
    limit: number,
  ): Promise<
    Array<{ staged: StagedRow; sourceSlug: string | null; eligible: boolean; reasons: string[] }>
  >;
}

export function createPromotionService(db: Db): PromotionService {
  return {
    async runBatch(maxItems) {
      const candidates = await selectCandidates(db, maxItems);
      return executeRun(db, "batch", candidates, undefined);
    },

    async promoteSingle(stagedProductId, operatorNote) {
      const candidate = await loadCandidate(db, stagedProductId);
      if (!candidate) {
        return {
          runId: null,
          totalItems: 0,
          promotedNew: 0,
          matchedExisting: 0,
          skipped: 0,
          failed: 0,
          outcomes: [],
        };
      }
      return executeRun(db, "single", [candidate], operatorNote);
    },

    async reject(stagedProductId, reason) {
      const candidate = await loadCandidate(db, stagedProductId);
      if (!candidate) return { ok: false, error: "staged product not found" };

      await db.transaction(async (tx) => {
        const [run] = await tx
          .insert(schema.promotionRuns)
          .values({
            status: "succeeded",
            triggerType: "single",
            totalItems: 1,
            skippedItems: 1,
            startedAt: new Date(),
            finishedAt: new Date(),
          })
          .returning({ id: schema.promotionRuns.id });
        if (!run) throw new Error("failed to create promotion run");

        await tx.insert(schema.promotionItems).values({
          promotionRunId: run.id,
          stagedProductId: candidate.staged.id,
          sourceId: candidate.staged.sourceId,
          decision: "rejected",
          confidenceScore: candidate.staged.confidenceScore,
          operatorNote: reason,
        });

        // The staged record becomes permanently not promotable.
        await tx
          .update(schema.stagedProducts)
          .set({
            validationStatus: "invalid",
            validationErrors: [
              ...(candidate.staged.validationErrors ?? []),
              `operator rejected: ${reason}`,
            ],
          })
          .where(eq(schema.stagedProducts.id, candidate.staged.id));
      });
      return { ok: true };
    },

    async listQueue(limit) {
      const candidates = await selectCandidates(db, limit);
      return candidates.map((candidate) => {
        const { reasons } = evaluate(candidate.staged);
        return {
          staged: candidate.staged,
          sourceSlug: candidate.sourceSlug,
          eligible: reasons.length === 0,
          reasons,
        };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Run orchestration
// ---------------------------------------------------------------------------

async function executeRun(
  db: Db,
  triggerType: PromotionTriggerType,
  candidates: StagedCandidate[],
  operatorNote: string | undefined,
): Promise<PromotionSummary> {
  const summary: PromotionSummary = {
    runId: null,
    totalItems: candidates.length,
    promotedNew: 0,
    matchedExisting: 0,
    skipped: 0,
    failed: 0,
    outcomes: [],
  };
  if (candidates.length === 0) return summary;

  const [run] = await db
    .insert(schema.promotionRuns)
    .values({
      status: "running",
      triggerType,
      totalItems: candidates.length,
      startedAt: new Date(),
    })
    .returning({ id: schema.promotionRuns.id });
  if (!run) throw new Error("failed to create promotion run");
  summary.runId = run.id;

  for (const candidate of candidates) {
    let outcome: ItemOutcome;
    try {
      outcome = await db.transaction((tx) => handleItem(tx, run.id, candidate, operatorNote));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcome = {
        stagedProductId: candidate.staged.id,
        decision: "failed",
        productId: null,
        matchStrategy: null,
        matchScore: null,
        reasons: [],
      };
      // Audit the failure outside the rolled-back transaction.
      await db.insert(schema.promotionItems).values({
        promotionRunId: run.id,
        stagedProductId: candidate.staged.id,
        sourceId: candidate.staged.sourceId,
        decision: "failed",
        confidenceScore: candidate.staged.confidenceScore,
        operatorNote: operatorNote ?? null,
        errorMessage: message,
      });
    }
    summary.outcomes.push(outcome);
    if (outcome.decision === "promoted_new") summary.promotedNew += 1;
    else if (outcome.decision === "matched_existing") summary.matchedExisting += 1;
    else if (outcome.decision === "failed") summary.failed += 1;
    else summary.skipped += 1;
  }

  await db
    .update(schema.promotionRuns)
    .set({
      status:
        summary.failed > 0 && summary.promotedNew + summary.matchedExisting === 0
          ? "failed"
          : "succeeded",
      promotedNew: summary.promotedNew,
      matchedExisting: summary.matchedExisting,
      skippedItems: summary.skipped,
      failedItems: summary.failed,
      finishedAt: new Date(),
    })
    .where(eq(schema.promotionRuns.id, run.id));

  return summary;
}

/** Staged products never considered before, valid, on product pages. */
async function selectCandidates(db: Db, limit: number): Promise<StagedCandidate[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select({ staged: schema.stagedProducts, sourceSlug: schema.sources.slug })
    .from(schema.stagedProducts)
    .leftJoin(schema.sources, eq(schema.stagedProducts.sourceId, schema.sources.id))
    .where(
      and(
        eq(schema.stagedProducts.validationStatus, "valid"),
        eq(schema.stagedProducts.pageType, "product"),
        notExists(
          db
            .select({ one: sql`1` })
            .from(schema.promotionItems)
            .where(eq(schema.promotionItems.stagedProductId, schema.stagedProducts.id)),
        ),
      ),
    )
    // Highest-trust evidence first: when the same product is staged from both
    // an api_json envelope (~0.97) and an older page render (~0.85), the
    // envelope must create the canonical record; the weaker twin then lands in
    // the ambiguous band and stays staged.
    .orderBy(
      sql`${schema.stagedProducts.confidenceScore} desc nulls last`,
      desc(schema.stagedProducts.createdAt),
    )
    .limit(limit);
  return rows;
}

async function loadCandidate(db: Db, stagedProductId: string): Promise<StagedCandidate | null> {
  const [row] = await db
    .select({ staged: schema.stagedProducts, sourceSlug: schema.sources.slug })
    .from(schema.stagedProducts)
    .leftJoin(schema.sources, eq(schema.stagedProducts.sourceId, schema.sources.id))
    .where(eq(schema.stagedProducts.id, stagedProductId))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Per-item promotion (one transaction)
// ---------------------------------------------------------------------------

async function handleItem(
  tx: Tx,
  runId: string,
  candidate: StagedCandidate,
  operatorNote: string | undefined,
): Promise<ItemOutcome> {
  const { staged, sourceSlug } = candidate;
  const audit = async (
    decision: PromotionDecision,
    extras: {
      productId?: string | null;
      matchStrategy?: MatchStrategy | null;
      matchScore?: number | null;
      reasons?: string[];
    } = {},
  ): Promise<ItemOutcome> => {
    await tx.insert(schema.promotionItems).values({
      promotionRunId: runId,
      stagedProductId: staged.id,
      sourceId: staged.sourceId,
      productId: extras.productId ?? null,
      decision,
      eligibilityReasons: extras.reasons ?? [],
      matchStrategy: extras.matchStrategy ?? null,
      matchScore: extras.matchScore != null ? extras.matchScore.toFixed(3) : null,
      confidenceScore: staged.confidenceScore,
      operatorNote: operatorNote ?? null,
    });
    return {
      stagedProductId: staged.id,
      decision,
      productId: extras.productId ?? null,
      matchStrategy: extras.matchStrategy ?? null,
      matchScore: extras.matchScore ?? null,
      reasons: extras.reasons ?? [],
    };
  };

  // Gate 1: eligibility.
  const { reasons } = evaluate(staged);
  if (!staged.sourceUrl) reasons.push("staged record has no source_url");
  if (reasons.length > 0) {
    return audit("skipped_ineligible", { reasons });
  }

  const normalizedUrl = normalizeSourceUrl(staged.sourceUrl as string);
  const payload = parsePayload(staged.normalizedPayload);

  // Gate 2: idempotency — the same normalized page already backs a product.
  const [existingLink] = await tx
    .select({ productId: schema.productSources.productId })
    .from(schema.productSources)
    .where(eq(schema.productSources.sourceUrl, normalizedUrl))
    .limit(1);
  if (existingLink) {
    await enrichExistingProduct(tx, existingLink.productId, staged, payload);
    await linkSourceAndMedia(
      tx,
      existingLink.productId,
      staged,
      sourceSlug,
      normalizedUrl,
      payload,
    );
    await refreshSearchDocument(tx, existingLink.productId);
    return audit("matched_existing", {
      productId: existingLink.productId,
      matchStrategy: "source_url",
      matchScore: 1,
    });
  }

  // Gate 3: identity within the resolved brand.
  const brandId = await resolveBrand(tx, staged.extractedBrand as string);
  const siblings = await tx
    .select({ id: schema.productsMaster.id, name: schema.productsMaster.name })
    .from(schema.productsMaster)
    .where(eq(schema.productsMaster.brandId, brandId));
  const match = pickMatch(staged.extractedName as string, siblings);

  if (match.kind === "ambiguous") {
    return audit("skipped_ambiguous", {
      matchScore: match.score,
      reasons: [
        `identity ambiguous: '${staged.extractedName}' is ${match.score} similar to existing product '${match.candidateName}' (${match.candidateId}) — kept staged`,
      ],
    });
  }

  if (match.kind === "matched") {
    await enrichExistingProduct(tx, match.productId, staged, payload);
    await linkSourceAndMedia(tx, match.productId, staged, sourceSlug, normalizedUrl, payload);
    await refreshSearchDocument(tx, match.productId);
    return audit("matched_existing", {
      productId: match.productId,
      matchStrategy: match.strategy,
      matchScore: match.score,
    });
  }

  // New canonical product.
  const categoryId = staged.extractedCategory
    ? await resolveCategory(tx, staged.extractedCategory)
    : null;
  const productTypeId =
    staged.extractedProductType && categoryId
      ? await resolveProductType(tx, staged.extractedProductType, categoryId)
      : null;

  const productId = await insertProduct(tx, staged, payload, {
    brandId,
    brandName: staged.extractedBrand as string,
    categoryId,
    productTypeId,
    sourceSlug,
  });
  await linkSourceAndMedia(tx, productId, staged, sourceSlug, normalizedUrl, payload);
  await refreshSearchDocument(tx, productId);
  return audit("promoted_new", { productId, matchStrategy: "new_product", matchScore: null });
}

function evaluate(staged: StagedRow): { reasons: string[] } {
  const result = evaluatePromotionEligibility({
    validationStatus: staged.validationStatus as never,
    pageType: staged.pageType as never,
    confidenceScore: staged.confidenceScore !== null ? Number(staged.confidenceScore) : null,
    extractedName: staged.extractedName,
    extractedBrand: staged.extractedBrand,
    unresolvedFields: staged.unresolvedFields ?? [],
  });
  return { reasons: [...result.reasons] };
}

// ---------------------------------------------------------------------------
// Canonical writes (all inside the item transaction)
// ---------------------------------------------------------------------------

/** Find-or-create master data — conservative/low-trust rows: name + slug only. */
async function resolveBrand(tx: Tx, brandName: string): Promise<string> {
  const slug = slugify(brandName);
  const [existing] = await tx
    .select({ id: schema.brands.id })
    .from(schema.brands)
    .where(eq(schema.brands.slug, slug))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await tx
    .insert(schema.brands)
    .values({ name: brandName, slug })
    .returning({ id: schema.brands.id });
  if (!created) throw new Error(`failed to create brand '${brandName}'`);
  return created.id;
}

async function resolveCategory(tx: Tx, categoryName: string): Promise<string> {
  const slug = slugify(categoryName);
  const [existing] = await tx
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(eq(schema.categories.slug, slug))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await tx
    .insert(schema.categories)
    .values({ name: categoryName, slug })
    .returning({ id: schema.categories.id });
  if (!created) throw new Error(`failed to create category '${categoryName}'`);
  return created.id;
}

async function resolveProductType(tx: Tx, typeName: string, categoryId: string): Promise<string> {
  const slug = slugify(typeName);
  const [existing] = await tx
    .select({ id: schema.productTypes.id })
    .from(schema.productTypes)
    .where(eq(schema.productTypes.slug, slug))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await tx
    .insert(schema.productTypes)
    .values({ name: typeName, slug, categoryId })
    .returning({ id: schema.productTypes.id });
  if (!created) throw new Error(`failed to create product type '${typeName}'`);
  return created.id;
}

async function insertProduct(
  tx: Tx,
  staged: StagedRow,
  payload: StagedPayload,
  refs: {
    brandId: string;
    brandName: string;
    categoryId: string | null;
    productTypeId: string | null;
    sourceSlug: string | null;
  },
): Promise<string> {
  const name = staged.extractedName as string;
  const slug = await uniqueProductSlug(tx, slugify(`${refs.brandName} ${name}`));
  const [created] = await tx
    .insert(schema.productsMaster)
    .values({
      slug,
      name,
      description: staged.extractedDescription,
      sku: payload.sku,
      barcode: payload.barcode,
      brandId: refs.brandId,
      categoryId: refs.categoryId,
      productTypeId: refs.productTypeId,
      priceBenchmarkUsd:
        payload.price && payload.price.currency === "USD" ? payload.price.value.toFixed(2) : null,
      primaryImageUrl: staged.primaryImageUrl ?? payload.image,
      dataQualityScore:
        staged.confidenceScore !== null ? (Number(staged.confidenceScore) * 100).toFixed(2) : null,
      dataSource: refs.sourceSlug,
      verified: false,
    })
    .returning({ id: schema.productsMaster.id });
  if (!created) throw new Error("failed to insert canonical product");
  return created.id;
}

async function uniqueProductSlug(tx: Tx, base: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [existing] = await tx
      .select({ id: schema.productsMaster.id })
      .from(schema.productsMaster)
      .where(eq(schema.productsMaster.slug, candidate))
      .limit(1);
    if (!existing) return candidate;
  }
  throw new Error(`could not derive a unique slug from '${base}'`);
}

/** Fill-if-null enrichment (approved): never overwrite trusted canonical values. */
async function enrichExistingProduct(
  tx: Tx,
  productId: string,
  staged: StagedRow,
  payload: StagedPayload,
): Promise<void> {
  const [product] = await tx
    .select()
    .from(schema.productsMaster)
    .where(eq(schema.productsMaster.id, productId))
    .limit(1);
  if (!product) throw new Error(`canonical product ${productId} disappeared during promotion`);

  const updates: Record<string, unknown> = {};
  if (!product.description && staged.extractedDescription) {
    updates.description = staged.extractedDescription;
  }
  if (!product.primaryImageUrl && (staged.primaryImageUrl ?? payload.image)) {
    updates.primaryImageUrl = staged.primaryImageUrl ?? payload.image;
  }
  if (!product.sku && payload.sku) updates.sku = payload.sku;
  if (!product.barcode && payload.barcode) updates.barcode = payload.barcode;
  if (product.priceBenchmarkUsd === null && payload.price && payload.price.currency === "USD") {
    updates.priceBenchmarkUsd = payload.price.value.toFixed(2);
  }
  if (product.categoryId === null && staged.extractedCategory) {
    updates.categoryId = await resolveCategory(tx, staged.extractedCategory);
  }
  if (product.productTypeId === null && staged.extractedProductType) {
    const categoryId = (updates.categoryId as string | undefined) ?? product.categoryId;
    if (categoryId) {
      updates.productTypeId = await resolveProductType(tx, staged.extractedProductType, categoryId);
    }
  }
  if (product.dataQualityScore === null && staged.confidenceScore !== null) {
    updates.dataQualityScore = (Number(staged.confidenceScore) * 100).toFixed(2);
  }
  if (Object.keys(updates).length > 0) {
    await tx
      .update(schema.productsMaster)
      .set(updates)
      .where(eq(schema.productsMaster.id, productId));
  }
}

async function linkSourceAndMedia(
  tx: Tx,
  productId: string,
  staged: StagedRow,
  sourceSlug: string | null,
  normalizedUrl: string,
  payload: StagedPayload,
): Promise<void> {
  await tx
    .insert(schema.productSources)
    .values({
      productId,
      sourceId: staged.sourceId,
      sourceSlug,
      stagedProductId: staged.id,
      sourceUrl: normalizedUrl,
      confidenceScore: staged.confidenceScore,
    })
    .onConflictDoUpdate({
      target: schema.productSources.sourceUrl,
      set: {
        stagedProductId: staged.id,
        confidenceScore: staged.confidenceScore,
        lastPromotedAt: new Date(),
      },
    });

  const imageUrl = staged.primaryImageUrl ?? payload.image;
  if (imageUrl) {
    await tx
      .insert(schema.productMedia)
      .values({ productId, mediaType: "image", url: imageUrl, sourceUrl: normalizedUrl })
      .onConflictDoNothing();
  }
}

/** Rewrite the search projection from current canonical state (same transaction). */
async function refreshSearchDocument(tx: Tx, productId: string): Promise<void> {
  const [row] = await tx
    .select({
      product: schema.productsMaster,
      brandName: schema.brands.name,
      categoryName: schema.categories.name,
      productTypeName: schema.productTypes.name,
    })
    .from(schema.productsMaster)
    .leftJoin(schema.brands, eq(schema.productsMaster.brandId, schema.brands.id))
    .leftJoin(schema.categories, eq(schema.productsMaster.categoryId, schema.categories.id))
    .leftJoin(schema.productTypes, eq(schema.productsMaster.productTypeId, schema.productTypes.id))
    .where(eq(schema.productsMaster.id, productId))
    .limit(1);
  if (!row) return;

  // Price/rating snapshots come from the freshest linked staged evidence.
  const [latestStaged] = await tx
    .select({ payload: schema.stagedProducts.normalizedPayload })
    .from(schema.productSources)
    .innerJoin(
      schema.stagedProducts,
      eq(schema.productSources.stagedProductId, schema.stagedProducts.id),
    )
    .where(eq(schema.productSources.productId, productId))
    .orderBy(desc(schema.productSources.lastPromotedAt))
    .limit(1);
  const payload = parsePayload(latestStaged?.payload ?? {});

  const searchText = [
    row.product.name,
    row.brandName,
    row.categoryName,
    row.productTypeName,
    row.product.description ? fold(row.product.description).slice(0, 500) : null,
  ]
    .filter(Boolean)
    .join(" ");

  const values = {
    productId,
    searchText,
    searchVector: sql`to_tsvector('english', ${searchText})`,
    brandName: row.brandName,
    categoryName: row.categoryName,
    productTypeName: row.productTypeName,
    priceValue: payload.price ? payload.price.value.toFixed(2) : null,
    priceCurrency: payload.price?.currency ?? null,
    rating: payload.rating ? payload.rating.value.toFixed(2) : null,
  };
  await tx
    .insert(schema.productSearchDocuments)
    .values(values)
    .onConflictDoUpdate({
      target: schema.productSearchDocuments.productId,
      set: { ...values, updatedAt: new Date() },
    });
}

function parsePayload(raw: unknown): StagedPayload {
  const payload = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const price = payload.price as { value?: unknown; currency?: unknown } | null | undefined;
  const rating = payload.rating as { value?: unknown } | null | undefined;
  return {
    price:
      price && typeof price.value === "number"
        ? {
            value: price.value,
            currency: typeof price.currency === "string" ? price.currency : null,
          }
        : null,
    rating: rating && typeof rating.value === "number" ? { value: rating.value } : null,
    image: typeof payload.image === "string" ? payload.image : null,
    barcode: typeof payload.barcode === "string" ? payload.barcode : null,
    sku: typeof payload.sku === "string" ? payload.sku : null,
  };
}
