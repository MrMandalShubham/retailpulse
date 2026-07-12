import { and, eq, inArray, isNotNull, schema, sql, type Db } from "@dip/db";
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
              sourceSlug: r.sourceSlug,
              discoveredProductName: r.discoveredProductName,
              productUrl: r.productUrl,
              normalizedUrl: r.normalizedUrl,
              urlHash: r.urlHash,
              discoveryMethod: r.discoveryMethod,
              pageTypeConfidence: r.pageTypeConfidence,
              discoveryStatus: r.discoveryStatus,
              discoveryRunId: r.discoveryRunId,
            })),
          )
          // Idempotent: re-discovery only bumps last_seen_at + run id; it never
          // resets a page's discovery_status or batch_status (preserve lifecycle).
          .onConflictDoUpdate({
            target: [dpp.sourceId, dpp.urlHash],
            set: {
              lastSeenAt: new Date(),
              discoveryRunId: sql`excluded.discovery_run_id`,
              // Reactivate a page that had gone stale but reappeared; otherwise
              // preserve its lifecycle (queued/promoted/rejected stay as-is).
              discoveryStatus: sql`case when ${dpp.discoveryStatus} = 'stale'
                then excluded.discovery_status else ${dpp.discoveryStatus} end`,
              updatedAt: new Date(),
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

    async markStale(sourceId, runId) {
      // Robust: a page not touched by THIS run has a different discovery_run_id.
      // (Avoids comparing DB now() against a client-generated timestamp.)
      const res = await db.execute(sql`
        update discovered_product_pages
        set discovery_status = 'stale', updated_at = now()
        where source_id = ${sourceId}
          and discovery_run_id is distinct from ${runId}
          and discovery_status in ('candidate','confirmed')
          and batch_status = 'pending'
      `);
      return res.rowCount ?? 0;
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

/**
 * Backfill: link discovered pages to their canonical product once promotion has
 * created a product_source with the same normalized URL. Idempotent.
 */
export async function backfillCanonical(db: Db): Promise<number> {
  const res = await db.execute(sql`
    update discovered_product_pages dpp
    set canonical_product_id = ps.product_id,
        batch_status = 'promoted',
        updated_at = now()
    from product_sources ps
    where dpp.normalized_url = ps.source_url
      and dpp.canonical_product_id is null
  `);
  return res.rowCount ?? 0;
}

/**
 * Batch handoff: take up to `limit` confirmed + pending pages for a source that
 * are NOT already in product_sources, write them into sources.seed_urls, and
 * mark them queued. The existing render/ingest flow reads seed_urls unchanged.
 */
export async function batchToSeedUrls(
  db: Db,
  sourceSlug: string,
  limit: number,
): Promise<{ queued: number; urls: string[]; sourceId: string | null }> {
  const [source] = await db
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(eq(schema.sources.slug, sourceSlug))
    .limit(1);
  if (!source) return { queued: 0, urls: [], sourceId: null };

  const dpp = schema.discoveredProductPages;
  const pending = await db
    .select({ id: dpp.id, normalizedUrl: dpp.normalizedUrl })
    .from(dpp)
    .where(
      and(
        eq(dpp.sourceId, source.id),
        eq(dpp.discoveryStatus, "confirmed"),
        eq(dpp.batchStatus, "pending"),
        sql`not exists (select 1 from product_sources ps where ps.source_url = ${dpp.normalizedUrl})`,
      ),
    )
    .orderBy(dpp.firstSeenAt)
    .limit(limit);

  if (pending.length === 0) return { queued: 0, urls: [], sourceId: source.id };

  const urls = pending.map((p) => p.normalizedUrl);
  await db.transaction(async (tx) => {
    await tx.update(schema.sources).set({ seedUrls: urls }).where(eq(schema.sources.id, source.id));
    await tx
      .update(dpp)
      .set({ batchStatus: "queued", updatedAt: new Date() })
      .where(inArray(dpp.id, pending.map((p) => p.id)));
  });
  return { queued: urls.length, urls, sourceId: source.id };
}
