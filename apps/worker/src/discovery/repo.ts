import { and, eq, isNotNull, schema, sql, type Db } from "@dip/db";
import type { DiscoveryRepo, PageRecord } from "./pipeline.js";

/** Drizzle-backed discovery repo (Phase 0a). */
export function createDiscoveryRepo(db: Db): DiscoveryRepo {
  const dpp = schema.discoveredProductPages;
  return {
    async listDiscoverableSources() {
      const rows = await db
        .select({
          id: schema.sources.id,
          slug: schema.sources.slug,
          baseUrl: schema.sources.baseUrl,
          discoveryConfig: schema.sources.discoveryConfig,
        })
        .from(schema.sources)
        .where(and(eq(schema.sources.enabled, true), isNotNull(schema.sources.discoveryConfig)));
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        baseUrl: r.baseUrl,
        discoveryConfig: (r.discoveryConfig as never) ?? null,
      }));
    },

    async createRun(sourceId, strategy) {
      const [row] = await db
        .insert(schema.discoveryRuns)
        .values({ sourceId, strategy, status: "running", startedAt: new Date() })
        .returning({ id: schema.discoveryRuns.id });
      if (!row) throw new Error("failed to create discovery run");
      return { id: row.id };
    },

    async upsertPages(records: PageRecord[]) {
      let newCount = 0;
      let updatedCount = 0;
      const CHUNK = 500;
      for (let i = 0; i < records.length; i += CHUNK) {
        const chunk = records.slice(i, i + CHUNK);
        const result = await db
          .insert(dpp)
          .values(
            chunk.map((r) => ({
              sourceId: r.sourceId,
              productId: r.productId,
              productName: r.productName,
              productUrl: r.productUrl,
              normalizedUrl: r.normalizedUrl,
            })),
          )
          // Idempotent: re-discovery refreshes name/url; it never resets
          // batch_status (preserve the ingestion lifecycle).
          .onConflictDoUpdate({
            target: [dpp.sourceId, dpp.productId],
            set: {
              productName: sql`excluded.product_name`,
              productUrl: sql`excluded.product_url`,
              normalizedUrl: sql`excluded.normalized_url`,
            },
          })
          .returning({ isNew: sql<boolean>`(xmax = 0)` });
        for (const r of result) {
          if (r.isNew) newCount += 1;
          else updatedCount += 1;
        }
      }
      return { newCount, updatedCount };
    },

    async finishRun(runId, status, counters, errorMessage) {
      await db
        .update(schema.discoveryRuns)
        .set({
          status,
          finishedAt: new Date(),
          urlsDiscovered: counters.urlsDiscovered,
          newUrls: counters.newUrls,
          updatedUrls: counters.updatedUrls,
          errors: counters.errors,
          errorMessage: errorMessage ?? null,
        })
        .where(eq(schema.discoveryRuns.id, runId));
    },
  };
}
