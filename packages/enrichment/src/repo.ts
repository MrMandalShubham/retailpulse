import { and, eq, isNull, or, schema, sql, type Db } from "@dip/db";
import type { EnrichCandidate, EnrichmentRecord, EnrichmentRepo } from "./service.js";

/** Drizzle-backed enrichment repo. Only additive writes; fill-if-null on canonical. */
export function createEnrichmentRepo(db: Db): EnrichmentRepo {
  const pm = schema.productsMaster;
  return {
    async listCandidates(limit): Promise<EnrichCandidate[]> {
      if (limit <= 0) return [];
      const rows = await db
        .select({
          productId: pm.id,
          name: pm.name,
          description: pm.description,
          categoryName: schema.categories.name,
          priceUsd: pm.priceBenchmarkUsd,
          brandName: schema.brands.name,
          spfValue: pm.spfValue,
          paRating: pm.paRating,
          texture: pm.texture,
          domain: pm.domain,
          priceSegment: pm.priceSegment,
          sizeValue: pm.sizeValue,
          sizeUnit: pm.sizeUnit,
          sourceUrl: sql<
            string | null
          >`(select ps.source_url from ${schema.productSources} ps where ps.product_id = ${pm.id} limit 1)`,
        })
        .from(pm)
        .leftJoin(schema.categories, eq(pm.categoryId, schema.categories.id))
        .leftJoin(schema.brands, eq(pm.brandId, schema.brands.id))
        .where(
          or(
            isNull(pm.spfValue),
            isNull(pm.paRating),
            isNull(pm.texture),
            isNull(pm.domain),
            isNull(pm.priceSegment),
            isNull(pm.sizeValue),
            isNull(pm.sizeUnit),
          ),
        )
        .limit(limit);

      return rows.map((r) => ({
        productId: r.productId,
        name: r.name,
        description: r.description,
        categoryName: r.categoryName,
        priceUsd: r.priceUsd != null ? Number(r.priceUsd) : null,
        brandName: r.brandName,
        sourceUrl: r.sourceUrl,
        current: {
          spfValue: r.spfValue,
          paRating: r.paRating,
          texture: r.texture,
          domain: r.domain,
          priceSegment: r.priceSegment,
          sizeValue: r.sizeValue,
          sizeUnit: r.sizeUnit,
        },
      }));
    },

    async createRun() {
      const [row] = await db
        .insert(schema.enrichmentRuns)
        .values({ status: "running", startedAt: new Date() })
        .returning({ id: schema.enrichmentRuns.id });
      if (!row) throw new Error("failed to create enrichment run");
      return row;
    },

    async finishRun(runId, status, counters, errorMessage) {
      await db
        .update(schema.enrichmentRuns)
        .set({
          status,
          finishedAt: new Date(),
          productsConsidered: counters.productsConsidered,
          deterministicApplied: counters.deterministicApplied,
          aiProposed: counters.aiProposed,
          needsSource: counters.needsSource,
          skipped: counters.skipped,
          errorMessage: errorMessage ?? null,
        })
        .where(eq(schema.enrichmentRuns.id, runId));
    },

    async upsertEnrichment(runId, rec: EnrichmentRecord) {
      await db
        .insert(schema.productEnrichments)
        .values({
          productId: rec.productId,
          fieldName: rec.fieldName,
          value: rec.value,
          method: rec.method,
          confidenceScore: rec.confidence != null ? rec.confidence.toFixed(3) : null,
          sourceUrl: rec.sourceUrl,
          sourceType: rec.sourceType,
          evidence: rec.evidence,
          status: rec.status,
          reason: rec.reason,
          enrichmentRunId: runId,
        })
        .onConflictDoUpdate({
          target: [schema.productEnrichments.productId, schema.productEnrichments.fieldName],
          set: {
            value: rec.value,
            method: rec.method,
            confidenceScore: rec.confidence != null ? rec.confidence.toFixed(3) : null,
            sourceUrl: rec.sourceUrl,
            sourceType: rec.sourceType,
            evidence: rec.evidence,
            status: rec.status,
            reason: rec.reason,
            enrichmentRunId: runId,
            updatedAt: new Date(),
          },
        });
    },

    async fillIfNull(productId, column, value) {
      // column comes from the trusted ENRICHABLE_FIELDS registry, not request input.
      await db.execute(
        sql`update products_master set ${sql.raw(`"${column}"`)} = ${value}
            where id = ${productId} and ${sql.raw(`"${column}"`)} is null`,
      );
    },
  };
}

/**
 * Review-gate: apply a PROPOSED enrichment (e.g. price_segment) to canonical.
 * The only path a non-deterministic value reaches products_master.
 */
export async function applyProposedEnrichment(
  db: Db,
  enrichmentId: string,
): Promise<{ ok: boolean; error?: string; column?: string; value?: string }> {
  const { ENRICHABLE_FIELDS } = await import("@dip/domain");
  const [row] = await db
    .select()
    .from(schema.productEnrichments)
    .where(eq(schema.productEnrichments.id, enrichmentId))
    .limit(1);
  if (!row) return { ok: false, error: "enrichment not found" };
  if (row.status !== "proposed")
    return { ok: false, error: `enrichment is '${row.status}', not proposed` };
  const cfg = ENRICHABLE_FIELDS.find((f) => f.field === row.fieldName);
  if (!cfg?.column || row.value == null)
    return { ok: false, error: "enrichment has no applicable value/column" };

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`update products_master set ${sql.raw(`"${cfg.column}"`)} = ${row.value}
          where id = ${row.productId} and ${sql.raw(`"${cfg.column}"`)} is null`,
    );
    await tx
      .update(schema.productEnrichments)
      .set({ status: "applied" })
      .where(eq(schema.productEnrichments.id, enrichmentId));
  });
  return { ok: true, column: cfg.column, value: row.value };
}

export async function rejectProposedEnrichment(
  db: Db,
  enrichmentId: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db
    .select({ id: schema.productEnrichments.id, status: schema.productEnrichments.status })
    .from(schema.productEnrichments)
    .where(eq(schema.productEnrichments.id, enrichmentId))
    .limit(1);
  if (!row) return { ok: false, error: "enrichment not found" };
  if (row.status !== "proposed")
    return { ok: false, error: `enrichment is '${row.status}', not proposed` };
  await db
    .update(schema.productEnrichments)
    .set({ status: "rejected", ...(reason ? { reason } : {}) })
    .where(and(eq(schema.productEnrichments.id, enrichmentId)));
  return { ok: true };
}
