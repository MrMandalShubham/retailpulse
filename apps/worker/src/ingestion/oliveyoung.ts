/**
 * Olive Young API fetcher. For one product it calls the site's own JSON
 * endpoints and assembles a VERBATIM envelope IN MEMORY (no storage) — the
 * clean step maps it straight into the per-platform table. Each endpoint is
 * fetched independently: a failure of one is recorded and never blocks others.
 *
 * Only detail-data is essential (name/brand/category/price/images).
 * details-info (ingredients/how-to-use/description) and review-summary
 * (rating/review count) enrich the record.
 *
 * The review-summary body was captured from the live app (Playwright request
 * interception): it needs prdtGbnCode (from detail-data) + filter flags; no
 * cookies/session required.
 */

const OY_API_BASE = "https://global.oliveyoung.com/product";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/** Endpoints captured per product (verbatim, in this order). */
export const OY_ENDPOINTS = ["detail-data", "details-info", "review-summary"] as const;
export type OyEndpoint = (typeof OY_ENDPOINTS)[number];

export interface PostJsonResult {
  ok: boolean;
  status: number;
  json: unknown | null;
}

export interface OyFetchDeps {
  postJson(url: string, body: unknown): Promise<PostJsonResult>;
}

/** The in-memory envelope: verbatim endpoint responses, nothing cleaned. */
export interface RawEnvelope {
  product_id: string;
  source: string;
  source_url: string;
  fetched_at: string;
  endpoints: Record<string, unknown>;
  http_status: Record<string, number>;
}

export interface OyProductResult {
  /** True when the essential endpoint (detail-data) returned JSON. */
  ok: boolean;
  envelope: RawEnvelope;
  httpStatus: number;
  endpointStatuses: Record<string, number>;
}

/** Base POST body that detail-data + details-info accept. */
function baseBody(prdtNo: string): Record<string, unknown> {
  return { prdtNo, langCode: "en", dlvCntry: "10", mrgnCntryCode: "10" };
}

/** Exact review-summary body as sent by the live app (captured via Playwright). */
function reviewBody(prdtNo: string, prdtGbnCode: string): Record<string, unknown> {
  return {
    filterYn: "N",
    prdtNo,
    prdtGbnCode,
    movReviewYn: "N",
    photoReviewYn: "N",
    optnYn: "N",
    transUseYn: "N",
    filterUseYn: "Y",
  };
}

export async function fetchOliveYoungProduct(
  prdtNo: string,
  productUrl: string,
  sourceSlug: string,
  deps: OyFetchDeps,
): Promise<OyProductResult> {
  const endpoints: Record<string, unknown> = {};
  const http: Record<string, number> = {};

  // 1) detail-data — essential; also yields prdtGbnCode for the review call.
  const detail = await deps.postJson(`${OY_API_BASE}/detail-data`, baseBody(prdtNo));
  endpoints["detail-data"] = detail.json;
  http["detail-data"] = detail.status;
  const prdtGbnCode = extractPrdtGbnCode(detail.json) ?? "10";

  // 2) details-info — description / ingredients / how-to-use.
  const info = await deps.postJson(`${OY_API_BASE}/details-info`, baseBody(prdtNo));
  endpoints["details-info"] = info.json;
  http["details-info"] = info.status;

  // 3) review-summary — rating / review count / star breakdown.
  const review = await deps.postJson(
    `${OY_API_BASE}/review-summary`,
    reviewBody(prdtNo, prdtGbnCode),
  );
  endpoints["review-summary"] = review.ok ? review.json : null;
  http["review-summary"] = review.status;

  const envelope: RawEnvelope = {
    product_id: prdtNo,
    source: sourceSlug,
    source_url: productUrl,
    fetched_at: new Date().toISOString(),
    endpoints,
    http_status: http,
  };
  return { ok: detail.ok, envelope, httpStatus: detail.status, endpointStatuses: http };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function extractPrdtGbnCode(detailJson: unknown): string | null {
  const g = (detailJson as any)?.product?.prdtGbnCode;
  return typeof g === "string" && g.length > 0 ? g : null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Default real-HTTP POST (JSON in, JSON out). Non-JSON responses → json=null. */
export async function defaultPostJson(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<PostJsonResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "user-agent": UA,
        accept: "application/json, text/plain, */*",
        origin: "https://global.oliveyoung.com",
        referer: "https://global.oliveyoung.com/",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const contentType = res.headers.get("content-type") ?? "";
    let json: unknown | null = null;
    if (contentType.includes("json")) {
      try {
        json = await res.json();
      } catch {
        json = null;
      }
    }
    return { ok: res.ok && json !== null, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}
