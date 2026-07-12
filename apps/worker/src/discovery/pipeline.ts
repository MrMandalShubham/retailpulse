import { createHash } from "node:crypto";
import type { DiscoveryConfig, DiscoveryMethod, DiscoveryStatus } from "@dip/domain";
import { normalizeSourceUrl } from "@dip/promotion";
import { discoverViaSitemap } from "./sitemap.js";

/**
 * Phase 0a discovery pipeline. For each enabled source with a sitemap
 * discovery_config: run the sitemap strategy → normalize + hash each URL
 * (SHARED normalizer, so normalized_url == product_sources.source_url later) →
 * upsert a lightweight mapping row. Idempotent: re-discovery bumps last_seen_at,
 * never resets a page's lifecycle. No extraction, no canonical writes.
 */

export interface DiscoverySourceRow {
  id: string;
  slug: string;
  baseUrl: string;
  discoveryConfig: DiscoveryConfig | null;
}

export interface PageRecord {
  sourceId: string;
  sourceSlug: string;
  discoveredProductName: string | null;
  productUrl: string;
  normalizedUrl: string;
  urlHash: string;
  discoveryMethod: DiscoveryMethod;
  pageTypeConfidence: string;
  discoveryStatus: DiscoveryStatus;
  discoveryRunId: string;
}

export interface DiscoveryRepo {
  listDiscoverableSources(): Promise<DiscoverySourceRow[]>;
  createRun(sourceId: string, strategy: string): Promise<{ id: string }>;
  upsertPages(records: PageRecord[]): Promise<{ newCount: number; updatedCount: number }>;
  /** Mark pending pages NOT touched by this run (different run id) as stale. */
  markStale(sourceId: string, runId: string): Promise<number>;
  finishRun(
    runId: string,
    status: "succeeded" | "failed",
    counters: { urlsDiscovered: number; newUrls: number; updatedUrls: number; errors: number },
    errorMessage?: string | null,
  ): Promise<void>;
}

export interface DiscoveryLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface DiscoveryDeps {
  repo: DiscoveryRepo;
  fetchText(url: string): Promise<string | null>;
  logger: DiscoveryLogger;
}

export interface DiscoverySummary {
  sourceSlug: string;
  runId: string | null;
  urlsDiscovered: number;
  newUrls: number;
  updatedUrls: number;
  staleUrls: number;
  status: "succeeded" | "failed" | "skipped";
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function runDiscoveryCycle(deps: DiscoveryDeps): Promise<DiscoverySummary[]> {
  const summaries: DiscoverySummary[] = [];
  const sources = await deps.repo.listDiscoverableSources();

  for (const source of sources) {
    const cfg = source.discoveryConfig;
    if (!cfg || cfg.strategy !== "sitemap") {
      deps.logger.info({ source: source.slug }, "no sitemap discovery_config — skipped");
      summaries.push(skip(source.slug));
      continue;
    }

    const { id: runId } = await deps.repo.createRun(source.id, "sitemap");
    try {
      const urls = await discoverViaSitemap(source.baseUrl, cfg, {
        fetchText: deps.fetchText,
        logger: deps.logger,
      });

      // Dedup by url_hash (two raw URLs can normalize to the same key).
      const byHash = new Map<string, PageRecord>();
      for (const u of urls) {
        const normalizedUrl = normalizeSourceUrl(u.url);
        const urlHash = sha256Hex(normalizedUrl);
        if (byHash.has(urlHash)) continue;
        byHash.set(urlHash, {
          sourceId: source.id,
          sourceSlug: source.slug,
          discoveredProductName: u.name,
          productUrl: u.url,
          normalizedUrl,
          urlHash,
          discoveryMethod: "sitemap",
          pageTypeConfidence: (u.isProduct ? 0.9 : 0.5).toFixed(3),
          discoveryStatus: u.isProduct ? "confirmed" : "candidate",
          discoveryRunId: runId,
        });
      }
      const records = [...byHash.values()];

      const { newCount, updatedCount } = await deps.repo.upsertPages(records);
      const staleUrls = await deps.repo.markStale(source.id, runId);
      await deps.repo.finishRun(runId, "succeeded", {
        urlsDiscovered: records.length,
        newUrls: newCount,
        updatedUrls: updatedCount,
        errors: 0,
      });
      deps.logger.info(
        { source: source.slug, discovered: records.length, new: newCount, updated: updatedCount, stale: staleUrls },
        "discovery run complete",
      );
      summaries.push({
        sourceSlug: source.slug,
        runId,
        urlsDiscovered: records.length,
        newUrls: newCount,
        updatedUrls: updatedCount,
        staleUrls,
        status: "succeeded",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await deps.repo.finishRun(
        runId,
        "failed",
        { urlsDiscovered: 0, newUrls: 0, updatedUrls: 0, errors: 1 },
        message,
      );
      deps.logger.error({ source: source.slug, error: message }, "discovery run failed");
      summaries.push({ ...skip(source.slug), runId, status: "failed" });
    }
  }
  return summaries;
}

function skip(sourceSlug: string): DiscoverySummary {
  return {
    sourceSlug,
    runId: null,
    urlsDiscovered: 0,
    newUrls: 0,
    updatedUrls: 0,
    staleUrls: 0,
    status: "skipped",
  };
}
