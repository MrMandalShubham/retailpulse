import type { DiscoveryConfig } from "@dip/domain";
import { fetchUrl } from "../ingestion/fetcher.js";

/**
 * Sitemap discovery strategy (Phase 0a) — deterministic, no browser, no AI.
 * robots.txt → sitemap URLs → parse (recursing sitemapindex → child sitemaps) →
 * candidate page URLs. Sitemaps are machine-generated and well-formed, so a
 * bounded <loc> extraction is robust and dependency-free.
 */

export interface DiscoveredUrl {
  url: string;
  name: string | null;
  /** true when a productUrlRegex confirmed this is a product page. */
  isProduct: boolean;
}

export interface SitemapDeps {
  fetchText(url: string): Promise<string | null>;
  logger: { info(o: unknown, m?: string): void; warn(o: unknown, m?: string): void };
}

const LOC_RE = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi;
const MAX_SITEMAP_DEPTH = 4;
const DEFAULT_MAX_URLS = 20_000;

/** Default text fetcher over the shared HTTP fetcher. */
export async function fetchTextDefault(url: string, timeoutMs: number): Promise<string | null> {
  const res = await fetchUrl(url, { timeoutMs, retries: 2 });
  if (!res.ok || !res.body) return null;
  return new TextDecoder("utf-8").decode(res.body);
}

/** Resolve the sitemap URLs to start from: explicit config, else robots.txt, else /sitemap.xml. */
async function resolveSitemapUrls(
  baseUrl: string,
  config: DiscoveryConfig,
  deps: SitemapDeps,
): Promise<string[]> {
  if (config.sitemapUrl) return [config.sitemapUrl];

  const origin = safeOrigin(baseUrl);
  if (origin) {
    const robots = await deps.fetchText(`${origin}/robots.txt`);
    if (robots) {
      const found = [...robots.matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim)].map((m) => m[1] as string);
      if (found.length > 0) {
        deps.logger.info({ count: found.length }, "sitemaps found via robots.txt");
        return found;
      }
    }
    return [`${origin}/sitemap.xml`];
  }
  return [];
}

/** Discover candidate product URLs from a source's sitemap(s). */
export async function discoverViaSitemap(
  baseUrl: string,
  config: DiscoveryConfig,
  deps: SitemapDeps,
): Promise<DiscoveredUrl[]> {
  const maxUrls = config.maxUrls ?? DEFAULT_MAX_URLS;
  const productRe = config.productUrlRegex ? safeRegex(config.productUrlRegex) : null;

  const seeds = await resolveSitemapUrls(baseUrl, config, deps);
  const visited = new Set<string>();
  const pages = new Map<string, DiscoveredUrl>(); // dedup within the run

  const queue: Array<{ url: string; depth: number }> = seeds.map((url) => ({ url, depth: 0 }));
  while (queue.length > 0 && pages.size < maxUrls) {
    const { url, depth } = queue.shift() as { url: string; depth: number };
    if (visited.has(url) || depth > MAX_SITEMAP_DEPTH) continue;
    visited.add(url);

    const xml = await deps.fetchText(url);
    if (!xml) {
      deps.logger.warn({ url }, "sitemap fetch failed — skipped");
      continue;
    }
    const isIndex = /<sitemapindex[\s>]/i.test(xml);
    const locs = [...xml.matchAll(LOC_RE)].map((m) => decodeEntities((m[1] as string).trim()));

    if (isIndex) {
      for (const child of locs) queue.push({ url: child, depth: depth + 1 });
      continue;
    }
    // urlset: these <loc>s are page URLs.
    for (const loc of locs) {
      if (pages.size >= maxUrls) break;
      // A urlset may itself list child sitemaps (rare); recurse those.
      if (/\.xml(\?|$)/i.test(loc) && /sitemap/i.test(loc)) {
        queue.push({ url: loc, depth: depth + 1 });
        continue;
      }
      const isProduct = productRe ? productRe.test(loc) : false;
      // With no productUrlRegex we can't confirm a product — keep as candidate.
      if (productRe && !isProduct) continue; // filter out non-product URLs when a regex exists
      if (!pages.has(loc)) pages.set(loc, { url: loc, name: null, isProduct });
    }
  }
  return [...pages.values()];
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
