import type { DiscoveryConfig } from "@dip/domain";
import type { DiscoveredUrl } from "./sitemap.js";

/**
 * Pagination discovery strategy (Phase 0) — for @cosme, whose catalog is reached
 * through paginated, server-rendered ranking listings (Shift_JIS HTML, no JSON
 * API). For each configured category it walks the ranking pages, decodes the
 * page with the configured charset, and pulls out the /products/{id}/ links.
 * Thin: it only collects product id + URL, nothing else — the ingest step
 * fetches and cleans each product page.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export interface PaginationDeps {
  /** Fetch raw page bytes (the pipeline wires this over the shared HTTP fetcher). */
  fetchBytes(url: string, userAgent?: string): Promise<Uint8Array | null>;
  logger: { info(o: unknown, m?: string): void; warn(o: unknown, m?: string): void };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function decode(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    // Unknown label — fall back to UTF-8 rather than throwing away the page.
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/**
 * Discover product pages by crawling paginated HTML listings. Reads
 * config.listingUrlTemplate ({cat} + {page}), config.categoryNos,
 * config.productIdRegex (one capture group), config.productUrlBase, and
 * config.charset. Dedups by product id across all categories/pages.
 */
export async function discoverViaPagination(
  config: DiscoveryConfig,
  deps: PaginationDeps,
): Promise<DiscoveredUrl[]> {
  const template = config.listingUrlTemplate;
  const cats = config.categoryNos ?? [];
  const base = config.productUrlBase;
  const idPattern = config.productIdRegex;
  if (!template || cats.length === 0 || !base || !idPattern) {
    deps.logger.warn(
      {},
      "pagination needs listingUrlTemplate, categoryNos, productUrlBase and productIdRegex",
    );
    return [];
  }
  const charset = config.charset ?? "utf-8";
  const maxPages = config.maxPagesPerCategory ?? 5;
  const maxUrls = config.maxUrls ?? 100_000;

  const pages = new Map<string, DiscoveredUrl>(); // dedup by product id across categories
  for (const cat of cats) {
    let emptyPages = 0;
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      if (pages.size >= maxUrls) break;
      const listUrl = template.replace("{cat}", cat).replace("{page}", String(pageNum));
      const bytes = await deps.fetchBytes(listUrl, UA);
      if (!bytes) {
        deps.logger.warn({ cat, pageNum, listUrl }, "listing fetch failed — skipped");
        break;
      }
      const html = decode(bytes, charset);
      // Fresh regex per page (global flag keeps lastIndex between calls otherwise).
      const re = new RegExp(idPattern, "g");
      const ids = new Set<string>();
      for (const m of html.matchAll(re)) {
        if (m[1]) ids.add(m[1]);
      }

      let added = 0;
      for (const id of ids) {
        if (pages.has(id)) continue;
        pages.set(id, {
          productId: id,
          url: `${base}${id}/`,
          name: null,
          isProduct: true,
        });
        added += 1;
      }
      deps.logger.info(
        { cat, pageNum, onPage: ids.size, added, total: pages.size },
        "listing page",
      );
      // Stop this category once pages stop contributing anything new.
      if (added === 0) {
        emptyPages += 1;
        if (emptyPages >= 2) break;
      } else {
        emptyPages = 0;
      }
      await sleep(300); // politeness
    }
  }
  return [...pages.values()];
}
