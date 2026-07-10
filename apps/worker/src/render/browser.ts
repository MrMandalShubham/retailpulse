import { type Browser, type BrowserContext, chromium } from "playwright";
import type { FetchResult } from "../ingestion/fetcher.js";
import { synthesizeProductHtml, type RenderedProduct } from "./synthesize.js";

/**
 * Phase 10 — headless-browser fetcher for JavaScript-rendered sources (e.g.
 * Olive Young Global, a Vue SPA behind Cloudflare). Renders each URL, waits for
 * the GTM dataLayer ecommerce event to populate, reads the structured product
 * record (readable brand/category/price from the GA4 `items` event), and
 * returns a synthesized JSON-LD Product document via the SAME FetchResult
 * contract as the plain HTTP fetcher — so it drops straight into the existing
 * ingestion pipeline with no other changes.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export interface Renderer {
  renderUrl(url: string): Promise<FetchResult>;
  close(): Promise<void>;
}

export interface RendererOptions {
  headless?: boolean;
  navTimeoutMs?: number;
  dataLayerTimeoutMs?: number;
}

/** Extraction that runs INSIDE the page. Reads the GA4 dataLayer + og meta. */
/* eslint-disable @typescript-eslint/no-explicit-any */
function extractInPage(): RenderedProduct {
  const w = globalThis as any;
  const doc = w.document;
  const dl: any[] = w.dataLayer ?? [];
  const og = (prop: string): string | null => {
    const m = doc.querySelector('meta[property="' + prop + '"]');
    return m ? m.getAttribute("content") : null;
  };
  const txt = (sel: string): string | null => {
    const el = doc.querySelector(sel);
    const t = el && el.textContent ? String(el.textContent).trim() : "";
    return t.length ? t : null;
  };

  // Name + price: the legacy Enhanced-Ecommerce productDetail event is reliable;
  // GA4 items are a price fallback.
  let legacy: any = null;
  for (const e of dl) {
    const p = e?.ecommerce?.detail?.products?.[0];
    if (p) legacy = p;
  }
  let ga4: any = null;
  let currency: string | null = null;
  for (const e of dl) {
    const items = e?.items ?? e?.ecommerce?.items;
    if (Array.isArray(items) && items[0] && (items[0].price != null || items[0].item_name)) {
      ga4 = items[0];
      currency = e?.currency ?? e?.ecommerce?.currency ?? currency;
    }
  }
  const price = legacy?.price ?? ga4?.price ?? null;

  // Readable brand + category come from the RENDERED DOM (the dataLayer only has
  // opaque codes). Vue has replaced the {{...}} placeholders with real text.
  const brand = txt('[data-testid="product-brand-name"]') ?? txt(".prd-brand-info a");
  const crumbs: string[] = Array.from(
    doc.querySelectorAll('[class*="breadcrumb" i] a, [class*="location" i] a'),
  )
    .map((a: any) => (a.textContent ? String(a.textContent).trim() : ""))
    .filter((t: string) => t.length > 0 && t.toLowerCase() !== "home");
  const category = crumbs.length ? crumbs[crumbs.length - 1] : null;

  return {
    id: legacy?.id ?? ga4?.item_id ?? null,
    nameEn: og("og:title"),
    nameLocal: legacy?.name ?? ga4?.item_name ?? null,
    brand: brand ?? null,
    category: category ?? null,
    price: price != null ? String(price) : null,
    currency: currency ?? og("product:price:currency") ?? "USD",
    image: og("og:image"),
  };
}

/** Predicate (runs in-page) — true once the ecommerce dataLayer has populated. */
function dataLayerReady(): boolean {
  const w = globalThis as any;
  const dl: any[] = w.dataLayer ?? [];
  return dl.some((e) => {
    const items = e?.items ?? e?.ecommerce?.items;
    return (
      e?.event === "productDetail" ||
      e?.ecommerce?.detail ||
      (Array.isArray(items) && items[0] && (items[0].item_brand || items[0].item_name))
    );
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function createRenderer(opts: RendererOptions = {}): Promise<Renderer> {
  const browser: Browser = await chromium.launch({ headless: opts.headless ?? true });
  const context: BrowserContext = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
  });
  // tsx/esbuild wraps named functions with a `__name()` helper that isn't
  // defined inside the page. Define it in every page so evaluate/waitForFunction
  // callbacks (which carry those wrappers) resolve it.
  await context.addInitScript({
    content: "globalThis.__name = globalThis.__name || function (f) { return f; };",
  });
  const navTimeout = opts.navTimeoutMs ?? 35_000;
  const dlTimeout = opts.dataLayerTimeoutMs ?? 12_000;

  async function renderUrl(url: string): Promise<FetchResult> {
    const page = await context.newPage();
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: navTimeout });
      const httpStatus = resp?.status() ?? 200;
      // Let the SPA hydrate + fire its GTM ecommerce event (best-effort).
      await page.waitForFunction(dataLayerReady, { timeout: dlTimeout }).catch(() => undefined);
      const record = await page.evaluate(extractInPage);
      const html = synthesizeProductHtml(url, record);
      const body = new TextEncoder().encode(html);
      return {
        ok: true,
        httpStatus,
        contentType: "text/html; charset=utf-8",
        body,
        errorMessage: null,
      };
    } catch (err) {
      return {
        ok: false,
        httpStatus: null,
        contentType: null,
        body: null,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    } finally {
      await page.close();
    }
  }

  return {
    renderUrl,
    async close() {
      await context.close();
      await browser.close();
    },
  };
}
