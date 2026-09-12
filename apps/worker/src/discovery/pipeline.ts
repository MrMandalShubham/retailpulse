import type { DiscoveryConfig } from "@dip/domain";
import { normalizeSourceUrl } from "./url.js";
import { discoverViaCategoryApi } from "./category.js";
import { discoverViaPagination } from "./cosme.js";
import { type DiscoveredUrl, discoverViaSitemap } from "./sitemap.js";

/**
 * Phase 0 discovery pipeline. For each enabled source with a discovery_config:
 * run its strategy (sitemap or category_crawl) → normalize each URL (SHARED
 * normalizer, so normalized_url == product_sources.source_url later) → upsert a
 * lean map row keyed by (source_id, product_id). Idempotent: re-discovery
 * refreshes name/url, never resets a page's lifecycle. No extraction, no
 * canonical writes.
 */

export interface DiscoverySourceRow {
  id: string;
  slug: string;
  baseUrl: string;
  discoveryConfig: DiscoveryConfig | null;
}

export interface PageRecord {
  sourceId: string;
  productId: string;
  productName: string | null;
  productUrl: string;
  normalizedUrl: string;
}

export interface DiscoveryRepo {
  listDiscoverableSources(): Promise<DiscoverySourceRow[]>;
  createRun(sourceId: string, strategy: string): Promise<{ id: string }>;
  upsertPages(records: PageRecord[]): Promise<{ newCount: number; updatedCount: number }>;
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
  postJson(url: string, body: unknown): Promise<unknown | null>;
  /** Raw page bytes (charset-agnostic) — used by the `pagination` strategy. */
  fetchBytes(url: string, userAgent?: string): Promise<Uint8Array | null>;
  logger: DiscoveryLogger;
  /** When set, only this source slug is discovered (else every enabled source). */
  onlySlug?: string;
}

const SUPPORTED: ReadonlySet<string> = new Set(["sitemap", "category_crawl", "pagination"]);

export interface DiscoverySummary {
  sourceSlug: string;
  runId: string | null;
  urlsDiscovered: number;
  newUrls: number;
  updatedUrls: number;
  status: "succeeded" | "failed" | "skipped";
}

export async function runDiscoveryCycle(deps: DiscoveryDeps): Promise<DiscoverySummary[]> {
  const summaries: DiscoverySummary[] = [];
  const allSources = await deps.repo.listDiscoverableSources();
  const sources = deps.onlySlug
    ? allSources.filter((s) => s.slug === deps.onlySlug)
    : allSources;

  for (const source of sources) {
    const cfg = source.discoveryConfig;
    if (!cfg || !SUPPORTED.has(cfg.strategy)) {
      deps.logger.info({ source: source.slug }, "no supported discovery_config — skipped");
      summaries.push(skip(source.slug));
      continue;
    }

    const { id: runId } = await deps.repo.createRun(source.id, cfg.strategy);
    try {
      let urls: DiscoveredUrl[];
      if (cfg.strategy === "category_crawl") {
        urls = await discoverViaCategoryApi(cfg, { postJson: deps.postJson, logger: deps.logger });
      } else if (cfg.strategy === "pagination") {
        urls = await discoverViaPagination(cfg, { fetchBytes: deps.fetchBytes, logger: deps.logger });
      } else {
        urls = await discoverViaSitemap(source.baseUrl, cfg, {
          fetchText: deps.fetchText,
          logger: deps.logger,
        });
      }

      // Dedup by native product id (the identity key).
      const byId = new Map<string, PageRecord>();
      for (const u of urls) {
        if (!u.productId || byId.has(u.productId)) continue;
        byId.set(u.productId, {
          sourceId: source.id,
          productId: u.productId,
          productName: u.name,
          productUrl: u.url,
          normalizedUrl: normalizeSourceUrl(u.url),
        });
      }
      const records = [...byId.values()];

      const { newCount, updatedCount } = await deps.repo.upsertPages(records);
      await deps.repo.finishRun(runId, "succeeded", {
        urlsDiscovered: records.length,
        newUrls: newCount,
        updatedUrls: updatedCount,
        errors: 0,
      });
      deps.logger.info(
        { source: source.slug, discovered: records.length, new: newCount, updated: updatedCount },
        "discovery run complete",
      );
      summaries.push({
        sourceSlug: source.slug,
        runId,
        urlsDiscovered: records.length,
        newUrls: newCount,
        updatedUrls: updatedCount,
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
    status: "skipped",
  };
}
