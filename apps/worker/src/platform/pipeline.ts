import { and, eq, ilike, isNotNull, schema, type Db } from "@dip/db";
import type { RawStorageAdapter } from "@dip/domain";
import { mapEnvelopeToCleanProduct, type CleanProduct } from "./oliveyoung-clean.js";

/**
 * Clean-load pipeline for the Olive Young per-platform store. Reads the Phase 1
 * raw JSON envelopes, transforms each into a clean typed row, and upserts it
 * into oliveyoung_global_products (idempotent on product_id). Read-only on the
 * raw layer; writes only the clean per-platform table.
 */

export interface PlatformLoadLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface PlatformLoadDeps {
  db: Db;
  storage: RawStorageAdapter;
  logger: PlatformLoadLogger;
  limit: number;
}

export interface PlatformLoadSummary {
  considered: number;
  upserted: number;
  skipped: number;
  failed: number;
}

export async function runOliveYoungCleanLoad(deps: PlatformLoadDeps): Promise<PlatformLoadSummary> {
  const summary: PlatformLoadSummary = { considered: 0, upserted: 0, skipped: 0, failed: 0 };

  const docs = await deps.db
    .select({
      id: schema.rawDocuments.id,
      storageKey: schema.rawDocuments.storageKey,
      url: schema.rawDocuments.url,
    })
    .from(schema.rawDocuments)
    .where(
      and(
        eq(schema.rawDocuments.status, "ok"),
        ilike(schema.rawDocuments.contentType, "%json%"),
        isNotNull(schema.rawDocuments.storageKey),
      ),
    )
    .limit(deps.limit);

  summary.considered = docs.length;
  for (const doc of docs) {
    if (!doc.storageKey) {
      summary.skipped += 1;
      continue;
    }
    try {
      const bytes = await deps.storage.get(doc.storageKey);
      const envelope = JSON.parse(new TextDecoder("utf-8").decode(bytes));
      const row = mapEnvelopeToCleanProduct(envelope, doc.id);
      if (!row) {
        summary.skipped += 1; // no essential detail-data (delisted / failed fetch)
        continue;
      }
      await upsertCleanProduct(deps.db, row);
      summary.upserted += 1;
    } catch (err) {
      summary.failed += 1;
      deps.logger.warn(
        { url: doc.url, error: err instanceof Error ? err.message : String(err) },
        "clean load failed for document",
      );
    }
  }

  deps.logger.info(summary, "olive young clean load complete");
  return summary;
}

async function upsertCleanProduct(db: Db, row: CleanProduct): Promise<void> {
  const t = schema.oliveyoungGlobalProducts;
  await db
    .insert(t)
    .values(row)
    .onConflictDoUpdate({
      target: t.productId,
      // Re-loading refreshes the clean row from the latest envelope.
      set: { ...row, updatedAt: new Date() },
    });
}
