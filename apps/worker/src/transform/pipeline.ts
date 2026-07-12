import {
  type ExtractionMethod,
  type ObservationType,
  type PageType,
  type RawStorageAdapter,
  type ValidationStatus,
} from "@dip/domain";
import { classifyPageType } from "./classify/page-type.js";
import { dominantMethod, recordConfidence, resolveAllFields } from "./classify/confidence.js";
import { validateStagedProduct } from "./classify/validate.js";
import { extractFromHtml, type HtmlExtraction } from "./extract/html.js";
import { bestMatch } from "./normalize/fuzzy.js";
import { parsePriceText } from "./normalize/price.js";
import { parseRatingText } from "./normalize/rating.js";
import { createRuleEngine, type RuleEngine, type RuleRow } from "./normalize/rule-engine.js";
import { stripTracking } from "./normalize/urls.js";

/**
 * Phase 3 hybrid transform pipeline:
 *   select eligible raw docs → deterministic extraction → local rule-based
 *   normalization → classification/scoring → validation → staged_products +
 *   transform_observations.
 *
 * Writes ONLY to the staging layer. The canonical 8-table core is read
 * (master-data names for fuzzy matching) but NEVER written — promotion is a
 * Phase 4 contract (see @dip/domain PromotionService).
 *
 * Staging decision matrix:
 *   product page                    → staged row (always)
 *   unknown page with a name        → staged row (low confidence)
 *   unknown page without a name     → weak_product_candidate observation only
 *   listing / non_product page      → unseen_pattern observation only
 */

export interface EligibleRawDocument {
  id: string;
  sourceId: string;
  sourceSlug: string;
  url: string;
  storageKey: string;
}

export interface StagedProductDraft {
  rawDocumentId: string;
  sourceId: string;
  sourceUrl: string;
  pageType: PageType;
  dominantSignal: string | null;
  extractedName: string | null;
  extractedBrand: string | null;
  extractedCategory: string | null;
  extractedProductType: string | null;
  extractedDescription: string | null;
  extractedCurrency: string | null;
  extractedPriceText: string | null;
  extractedRatingText: string | null;
  primaryImageUrl: string | null;
  extractionMethod: ExtractionMethod | null;
  confidenceScore: string | null;
  validationStatus: ValidationStatus;
  validationErrors: string[];
  normalizedPayload: Record<string, unknown>;
  fieldCandidates: Record<string, unknown>;
  fieldConfidences: Record<string, number>;
  unresolvedFields: string[];
  aiRecommended: boolean;
}

export interface ObservationDraft {
  rawDocumentId: string;
  observationType: ObservationType;
  fieldName: string | null;
  rawValue: string | null;
  suggestedValue: string | null;
  confidenceScore: string | null;
  notes: string | null;
  /** Attach to the staged product persisted for the same document, if any. */
  attachToStaged: boolean;
}

export interface MasterData {
  brands: string[];
  categories: string[];
  productTypes: string[];
}

export interface TransformRepo {
  listEligibleRawDocuments(opts: {
    limit: number;
    reprocess: boolean;
  }): Promise<EligibleRawDocument[]>;
  /** Reprocess support: staging is regenerable; open observations are replaced too. */
  deleteStagedForRawDocuments(rawDocumentIds: string[]): Promise<void>;
  createRun(totalDocuments: number): Promise<{ id: string }>;
  markRunRunning(runId: string): Promise<void>;
  finishRun(
    runId: string,
    status: "succeeded" | "failed",
    counters: { processed: number; succeeded: number; failed: number },
    errorMessage?: string | null,
  ): Promise<void>;
  insertStagedProduct(runId: string, draft: StagedProductDraft): Promise<{ id: string }>;
  insertObservations(
    runId: string,
    stagedProductId: string | null,
    drafts: ObservationDraft[],
  ): Promise<void>;
  loadActiveRules(): Promise<RuleRow[]>;
  loadMasterData(): Promise<MasterData>;
}

export interface TransformLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface TransformDeps {
  repo: TransformRepo;
  storage: RawStorageAdapter;
  logger: TransformLogger;
  maxDocuments: number;
  reprocess: boolean;
}

export interface TransformSummary {
  runId: string | null;
  totalDocuments: number;
  processedDocuments: number;
  succeededDocuments: number;
  failedDocuments: number;
  stagedProducts: number;
  observations: number;
  ignoredDocuments: number;
}

export async function runTransformCycle(deps: TransformDeps): Promise<TransformSummary> {
  const summary: TransformSummary = {
    runId: null,
    totalDocuments: 0,
    processedDocuments: 0,
    succeededDocuments: 0,
    failedDocuments: 0,
    stagedProducts: 0,
    observations: 0,
    ignoredDocuments: 0,
  };

  const [rules, master, documents] = await Promise.all([
    deps.repo.loadActiveRules(),
    deps.repo.loadMasterData(),
    deps.repo.listEligibleRawDocuments({ limit: deps.maxDocuments, reprocess: deps.reprocess }),
  ]);
  summary.totalDocuments = documents.length;
  if (documents.length === 0) {
    deps.logger.info({}, "no eligible raw documents — nothing to transform");
    return summary;
  }

  if (deps.reprocess) {
    await deps.repo.deleteStagedForRawDocuments(documents.map((d) => d.id));
    deps.logger.info({ documents: documents.length }, "reprocess: cleared prior staged output");
  }

  const { id: runId } = await deps.repo.createRun(documents.length);
  summary.runId = runId;
  await deps.repo.markRunRunning(runId);

  for (const document of documents) {
    summary.processedDocuments += 1;
    try {
      const engine = createRuleEngine(rules, document.sourceSlug);
      if (engine.isIgnoredUrl(document.url)) {
        summary.ignoredDocuments += 1;
        summary.succeededDocuments += 1;
        deps.logger.info({ url: document.url }, "url matches ignore_pattern rule — skipped");
        continue;
      }

      const payload = await deps.storage.get(document.storageKey);
      const html = new TextDecoder("utf-8").decode(payload);
      const result = processDocument(document, html, engine, master);

      let stagedProductId: string | null = null;
      if (result.staged) {
        const inserted = await deps.repo.insertStagedProduct(runId, result.staged);
        stagedProductId = inserted.id;
        summary.stagedProducts += 1;
      }
      if (result.observations.length > 0) {
        await deps.repo.insertObservations(runId, stagedProductId, result.observations);
        summary.observations += result.observations.length;
      }
      summary.succeededDocuments += 1;
    } catch (err) {
      summary.failedDocuments += 1;
      const message = err instanceof Error ? err.message : String(err);
      deps.logger.error({ url: document.url, error: message }, "document transform failed");
    }
  }

  const runStatus =
    summary.failedDocuments > 0 && summary.succeededDocuments === 0 ? "failed" : "succeeded";
  await deps.repo.finishRun(runId, runStatus, {
    processed: summary.processedDocuments,
    succeeded: summary.succeededDocuments,
    failed: summary.failedDocuments,
  });
  return summary;
}

export interface DocumentResult {
  staged: StagedProductDraft | null;
  observations: ObservationDraft[];
}

/** Pure per-document transform — unit-testable without storage or DB. */
export function processDocument(
  document: EligibleRawDocument,
  html: string,
  engine: RuleEngine,
  master: MasterData,
): DocumentResult {
  const extraction = extractFromHtml(html, document.url, engine);
  const classification = classifyPageType(extraction.signals);
  const resolution = resolveAllFields(extraction.candidates);
  const observations: ObservationDraft[] = [];

  const name = resolution.resolved.get("name")?.value ?? null;

  // Pages that are not product candidates: observation, no staged row.
  if (
    classification.pageType === "listing" ||
    classification.pageType === "non_product" ||
    (classification.pageType === "unknown" && !name)
  ) {
    observations.push({
      rawDocumentId: document.id,
      observationType:
        classification.pageType === "unknown" ? "weak_product_candidate" : "unseen_pattern",
      fieldName: "page",
      rawValue: document.url,
      suggestedValue: classification.pageType,
      confidenceScore: classification.score.toFixed(3),
      notes: `classified as '${classification.pageType}' (dominant signal: ${classification.dominantSignal}); no product candidate staged`,
      attachToStaged: false,
    });
    return { staged: null, observations };
  }

  // ---- Local normalization over resolved candidates ----------------------
  const brandRaw = resolution.resolved.get("brand")?.value ?? null;
  // normalizeBrand still emits an unknown_brand observation (for future alias
  // learning / canonicalization); a present brand is promotable regardless.
  const { brand } = normalizeBrand(brandRaw, engine, master, observations, document);

  const categoryRaw = resolution.resolved.get("category")?.value ?? null;
  const category = normalizeCategory(categoryRaw, name, engine, master, observations, document);

  const productType = engine.productTypeFor(name ?? "");
  if (!productType && name && classification.pageType === "product") {
    observations.push({
      rawDocumentId: document.id,
      observationType: "unknown_product_type",
      fieldName: "product_type",
      rawValue: name,
      suggestedValue: null,
      confidenceScore: null,
      notes: "no product_type_keyword rule matched the product name",
      attachToStaged: true,
    });
  }

  const priceField = resolution.resolved.get("price_text");
  const parsedPrice = parsePriceText(priceField?.value, engine.currencySymbolMap());
  const currency =
    parsedPrice?.currency ?? resolution.resolved.get("currency")?.value?.toUpperCase() ?? null;
  if (priceField?.conflict) {
    observations.push({
      rawDocumentId: document.id,
      observationType: "conflicting_price",
      fieldName: "price_text",
      rawValue: priceField.value,
      suggestedValue: parsedPrice ? String(parsedPrice.value) : null,
      confidenceScore: priceField.confidence.toFixed(3),
      notes: "extraction methods disagree on the price",
      attachToStaged: true,
    });
  }

  const ratingField = resolution.resolved.get("rating_text");
  const parsedRating = parseRatingText(ratingField?.value);

  if (!name) {
    observations.push({
      rawDocumentId: document.id,
      observationType: "missing_required_field",
      fieldName: "name",
      rawValue: document.url,
      suggestedValue: null,
      confidenceScore: null,
      notes: "product-like page without an extractable name",
      attachToStaged: true,
    });
  }

  const confidenceScore = recordConfidence(resolution.fieldConfidences);
  const validation = validateStagedProduct({
    pageType: classification.pageType,
    name,
    brandPresent: Boolean(brand),
    priceTextPresent: Boolean(priceField),
    priceParsed: Boolean(parsedPrice),
    // Only critical-field conflicts gate validation; e.g. meta vs OG
    // description wording differences are normal noise, not review triggers.
    conflicts: resolution.conflicts.filter((f) => ["name", "brand", "price_text"].includes(f)),
    unresolvedFields: resolution.unresolvedFields,
    confidenceScore,
  });

  const staged: StagedProductDraft = {
    rawDocumentId: document.id,
    sourceId: document.sourceId,
    sourceUrl: stripTracking(document.url),
    pageType: classification.pageType,
    dominantSignal: classification.dominantSignal,
    extractedName: name,
    extractedBrand: brand,
    extractedCategory: category,
    extractedProductType: productType,
    extractedDescription: resolution.resolved.get("description")?.value ?? null,
    extractedCurrency: currency,
    extractedPriceText: priceField?.value ?? null,
    extractedRatingText: ratingField?.value ?? null,
    primaryImageUrl: resolution.resolved.get("image")?.value ?? null,
    extractionMethod: dominantMethod(resolution.resolved),
    confidenceScore: confidenceScore.toFixed(3),
    validationStatus: validation.status,
    validationErrors: validation.errors,
    normalizedPayload: buildNormalizedPayload({
      name,
      brand,
      category,
      productType,
      parsedPrice,
      currency,
      parsedRating,
      image: resolution.resolved.get("image")?.value ?? null,
      url: stripTracking(document.url),
    }),
    fieldCandidates: candidatesToJson(extraction),
    fieldConfidences: resolution.fieldConfidences,
    unresolvedFields: resolution.unresolvedFields,
    // AI is worth spending on: plausible product with gaps local logic can't close.
    aiRecommended: Boolean(name) && resolution.unresolvedFields.length > 0,
  };

  return { staged, observations };
}

function normalizeBrand(
  brandRaw: string | null,
  engine: RuleEngine,
  master: MasterData,
  observations: ObservationDraft[],
  document: EligibleRawDocument,
): { brand: string | null; brandResolved: boolean } {
  if (!brandRaw) return { brand: null, brandResolved: false };

  const alias = engine.brandAlias(brandRaw);
  if (alias) return { brand: alias, brandResolved: true };

  const { match, nearMiss } = bestMatch(brandRaw, master.brands);
  if (match) return { brand: match.value, brandResolved: true };

  observations.push({
    rawDocumentId: document.id,
    observationType: "unknown_brand",
    fieldName: "brand",
    rawValue: brandRaw,
    suggestedValue: nearMiss?.value ?? null,
    confidenceScore: nearMiss ? nearMiss.score.toFixed(3) : null,
    notes: nearMiss
      ? "fuzzy near-miss against master data — candidate for brand_alias rule"
      : "brand not in master data and no alias rule matched",
    attachToStaged: true,
  });
  return { brand: brandRaw, brandResolved: false };
}

function normalizeCategory(
  categoryRaw: string | null,
  name: string | null,
  engine: RuleEngine,
  master: MasterData,
  observations: ObservationDraft[],
  document: EligibleRawDocument,
): string | null {
  const searchText = [categoryRaw, name].filter(Boolean).join(" ");
  if (!searchText) return null;

  const ruleHit = engine.categoryFor(searchText);
  if (ruleHit) return ruleHit;

  if (categoryRaw) {
    const { match, nearMiss } = bestMatch(categoryRaw, master.categories);
    if (match) return match.value;
    observations.push({
      rawDocumentId: document.id,
      observationType: "unknown_category",
      fieldName: "category",
      rawValue: categoryRaw,
      suggestedValue: nearMiss?.value ?? null,
      confidenceScore: nearMiss ? nearMiss.score.toFixed(3) : null,
      notes: "category text not mappable via rules or master data",
      attachToStaged: true,
    });
    return categoryRaw;
  }
  return null;
}

function buildNormalizedPayload(input: {
  name: string | null;
  brand: string | null;
  category: string | null;
  productType: string | null;
  parsedPrice: { value: number; currency: string | null; raw: string } | null;
  currency: string | null;
  parsedRating: { rating: number; reviewCount: number | null; raw: string } | null;
  image: string | null;
  url: string;
}): Record<string, unknown> {
  return {
    name: input.name,
    brand: input.brand,
    category: input.category,
    productType: input.productType,
    // Shaped so it can be lifted into staged_product_offers mechanically later.
    price: input.parsedPrice
      ? { value: input.parsedPrice.value, currency: input.currency, raw: input.parsedPrice.raw }
      : null,
    rating: input.parsedRating
      ? {
          value: input.parsedRating.rating,
          reviewCount: input.parsedRating.reviewCount,
          raw: input.parsedRating.raw,
        }
      : null,
    image: input.image,
    url: input.url,
  };
}

function candidatesToJson(extraction: HtmlExtraction): Record<string, unknown> {
  const json: Record<string, unknown> = {};
  for (const [field, list] of extraction.candidates) {
    json[field] = list.map((c) => ({ value: c.value, method: c.method }));
  }
  return json;
}
