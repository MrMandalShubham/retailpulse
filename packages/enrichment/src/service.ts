import {
  ENRICHABLE_FIELDS,
  type EnrichmentMethod,
  type EnrichmentSourceType,
  type EnrichmentStatus,
  type ExtractionOutcome,
} from "@dip/domain";
import {
  classifyPriceSegment,
  extractDomain,
  extractPa,
  extractSize,
  extractSpf,
  extractTexture,
  type EnrichmentContext,
} from "./extractors.js";

/**
 * @dip/enrichment — Phase 7 enrichment cycle. Deterministic + heuristic (tiers
 * 1–2) run here; tier-3 AI extraction plugs in later via the same repo/record
 * shape. Guarantees: fill-if-null only, review-gated for non-literal outputs,
 * full provenance for every attempt (value or a needs_source reason).
 */

export interface EnrichCandidate {
  productId: string;
  name: string;
  description: string | null;
  categoryName: string | null;
  priceUsd: number | null;
  brandName: string | null;
  sourceUrl: string | null;
  /** Current values of the enrichable columns (to enforce fill-if-null). */
  current: Record<string, unknown>;
}

export interface EnrichmentRecord {
  productId: string;
  fieldName: string;
  value: string | null;
  method: EnrichmentMethod;
  confidence: number | null;
  sourceUrl: string | null;
  sourceType: EnrichmentSourceType;
  evidence: string | null;
  status: EnrichmentStatus;
  reason: string | null;
}

export interface EnrichmentRepo {
  listCandidates(limit: number): Promise<EnrichCandidate[]>;
  createRun(): Promise<{ id: string }>;
  finishRun(
    runId: string,
    status: "succeeded" | "failed",
    counters: {
      productsConsidered: number;
      deterministicApplied: number;
      aiProposed: number;
      needsSource: number;
      skipped: number;
    },
    errorMessage?: string | null,
  ): Promise<void>;
  upsertEnrichment(runId: string, rec: EnrichmentRecord): Promise<void>;
  /** Fill-if-null: writes the column only if currently null. */
  fillIfNull(productId: string, column: string, value: string): Promise<void>;
}

export interface EnrichLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface EnrichSummary {
  runId: string | null;
  productsConsidered: number;
  deterministicApplied: number;
  aiProposed: number;
  needsSource: number;
  skipped: number;
}

const REGISTRY = new Map(ENRICHABLE_FIELDS.map((f) => [f.field, f]));
const PAGE_FIELDS = new Set(["spf_value", "pa_rating", "size_value", "size_unit", "texture"]);

export async function runEnrichmentCycle(deps: {
  repo: EnrichmentRepo;
  logger: EnrichLogger;
  maxProducts: number;
}): Promise<EnrichSummary> {
  const summary: EnrichSummary = {
    runId: null,
    productsConsidered: 0,
    deterministicApplied: 0,
    aiProposed: 0,
    needsSource: 0,
    skipped: 0,
  };

  const candidates = await deps.repo.listCandidates(deps.maxProducts);
  if (candidates.length === 0) {
    deps.logger.info({}, "no products with enrichable nulls — nothing to enrich");
    return summary;
  }
  const { id: runId } = await deps.repo.createRun();
  summary.runId = runId;
  summary.productsConsidered = candidates.length;

  try {
    for (const c of candidates) {
      const ctx: EnrichmentContext = {
        name: c.name,
        description: c.description,
        categoryName: c.categoryName,
        priceUsd: c.priceUsd,
        brandName: c.brandName,
      };

      // Compute outcomes only for fields still null on this product.
      const outcomes: Record<string, ExtractionOutcome> = {};
      const isNull = (f: string) => c.current[camel(f)] == null;
      if (isNull("spf_value")) outcomes.spf_value = extractSpf(ctx);
      if (isNull("pa_rating")) outcomes.pa_rating = extractPa(ctx);
      if (isNull("texture")) outcomes.texture = extractTexture(ctx);
      if (isNull("domain")) outcomes.domain = extractDomain(ctx);
      if (isNull("price_segment")) outcomes.price_segment = classifyPriceSegment(ctx);
      if (isNull("size_value") || isNull("size_unit")) {
        const size = extractSize(ctx);
        if (isNull("size_value")) outcomes.size_value = size.value;
        if (isNull("size_unit")) outcomes.size_unit = size.unit;
      }

      for (const [field, outcome] of Object.entries(outcomes)) {
        const cfg = REGISTRY.get(field);
        if (!cfg) continue;
        const sourceType: EnrichmentSourceType = PAGE_FIELDS.has(field)
          ? "product_page"
          : "derived";

        if (!outcome.found) {
          await deps.repo.upsertEnrichment(runId, {
            productId: c.productId,
            fieldName: field,
            value: null,
            method: PAGE_FIELDS.has(field) ? "regex" : "rule",
            confidence: null,
            sourceUrl: c.sourceUrl,
            sourceType,
            evidence: null,
            status: "needs_source",
            reason: outcome.reason,
          });
          summary.needsSource += 1;
          continue;
        }

        const status: EnrichmentStatus = cfg.autoApply ? "applied" : "proposed";
        await deps.repo.upsertEnrichment(runId, {
          productId: c.productId,
          fieldName: field,
          value: outcome.value,
          method: outcome.method,
          confidence: outcome.confidence,
          sourceUrl: c.sourceUrl,
          sourceType,
          evidence: outcome.evidence,
          status,
          reason: null,
        });
        if (status === "applied" && cfg.column) {
          await deps.repo.fillIfNull(c.productId, cfg.column, outcome.value);
          summary.deterministicApplied += 1;
        } else {
          summary.aiProposed += 1; // proposed for review (heuristic / AI)
        }
      }
    }
    await deps.repo.finishRun(runId, "succeeded", summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.repo.finishRun(runId, "failed", summary, message);
    deps.logger.error({ error: message }, "enrichment cycle failed");
    throw err;
  }
  return summary;
}

/** snake_case field → camelCase key used in the candidate's `current` map. */
function camel(s: string): string {
  return s.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}
