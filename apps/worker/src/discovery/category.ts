import type { DiscoveryConfig } from "@dip/domain";
import type { DiscoveredUrl } from "./sitemap.js";

/**
 * Category-crawl discovery (Phase 0b) — for sites whose sitemap is incomplete.
 * Calls the site's own paginated product-list JSON API (deterministic, no
 * browser). Reaches the FULL catalog, not just the SEO-listed subset. Still
 * thin: it only collects product URL + name, nothing else.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/** Default POST fetcher returning parsed JSON, or null on error. */
export async function postJsonDefault(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "user-agent": UA,
        accept: "application/json, text/plain, */*",
        origin: new URL(url).origin,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

export interface CategoryDeps {
  postJson(url: string, body: unknown): Promise<unknown | null>;
  logger: { info(o: unknown, m?: string): void; warn(o: unknown, m?: string): void };
}

/** Base POST body shape; site-specific constants are merged via requestTemplate. */
const DEFAULT_BODY: Record<string, unknown> = {
  accParam: "",
  langCode: "en",
  previewDate: "",
  encKey: "",
  encText: "",
  dlvCntry: "10",
  mrgnCntryCode: "",
  attrValNo: "",
  prdtSortStdrCode: "10",
  attrValNoList: {},
  brandNoList: [],
  ctgrNoList: [],
  eventSlprcDscntRt: [],
  reviewScore: [],
  scrollY: 0,
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* eslint-disable @typescript-eslint/no-explicit-any */
function firstStr(v: any): string | null {
  const x = Array.isArray(v) ? v[0] : v;
  if (typeof x === "string") return x.trim() || null;
  if (typeof x === "number") return String(x);
  return null;
}

export async function discoverViaCategoryApi(
  config: DiscoveryConfig,
  deps: CategoryDeps,
): Promise<DiscoveredUrl[]> {
  const apiUrl = config.categoryApiUrl;
  const cats = config.categoryNos ?? [];
  const base = config.productUrlBase;
  if (!apiUrl || cats.length === 0 || !base) {
    deps.logger.warn({}, "category_crawl needs categoryApiUrl, categoryNos and productUrlBase");
    return [];
  }
  const rows = config.rowsPerPage ?? 100;
  const maxPages = config.maxPagesPerCategory ?? 500;
  const maxUrls = config.maxUrls ?? 100_000;

  const pages = new Map<string, DiscoveredUrl>(); // dedup by product id across categories
  for (const ctgrNo of cats) {
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      if (pages.size >= maxUrls) break;
      const body = {
        ...DEFAULT_BODY,
        ...(config.requestTemplate ?? {}),
        ctgrNo,
        pageNum,
        rowsPerPage: String(rows),
      };
      const json = (await deps.postJson(apiUrl, body)) as any;
      const hits: any[] | undefined = json?.hits?.hit;
      if (!Array.isArray(hits) || hits.length === 0) break;
      for (const h of hits) {
        const f = h?.fields ?? {};
        const prdtNo = firstStr(f.prdtNo);
        if (!prdtNo || pages.has(prdtNo)) continue;
        pages.set(prdtNo, {
          productId: prdtNo,
          url: base + prdtNo,
          name: firstStr(f.prdtName),
          isProduct: true,
        });
      }
      deps.logger.info({ ctgrNo, pageNum, hits: hits.length, total: pages.size }, "category page");
      if (hits.length < rows) break; // last page for this category
      await sleep(250); // politeness
    }
  }
  return [...pages.values()];
}
/* eslint-enable @typescript-eslint/no-explicit-any */
