/**
 * Minimal polite HTTP fetcher for Phase 2 raw ingestion.
 * Static fetch only (no browser rendering); small retry/backoff so temporary
 * network blips and 5xx responses don't fail a whole crawl job.
 */

export interface FetchResult {
  ok: boolean;
  httpStatus: number | null;
  contentType: string | null;
  body: Uint8Array | null;
  errorMessage: string | null;
}

export interface FetchUrlOptions {
  timeoutMs: number;
  /** Extra attempts after the first (network errors and 5xx only). */
  retries?: number;
  backoffBaseMs?: number;
  userAgent?: string;
}

const DEFAULT_USER_AGENT = "DIPEngine/0.2 (product data ingestion)";

export async function fetchUrl(url: string, options: FetchUrlOptions): Promise<FetchResult> {
  const retries = options.retries ?? 2;
  const backoffBaseMs = options.backoffBaseMs ?? 500;
  let lastError = "unreachable";

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await sleep(backoffBaseMs * 2 ** (attempt - 1));
    }
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(options.timeoutMs),
        redirect: "follow",
        headers: {
          "user-agent": options.userAgent ?? DEFAULT_USER_AGENT,
          accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        },
      });
      const contentType = response.headers.get("content-type");

      // 5xx is worth retrying; 4xx is a definitive answer for this URL.
      if (response.status >= 500 && attempt < retries) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      if (!response.ok) {
        return {
          ok: false,
          httpStatus: response.status,
          contentType,
          body: null,
          errorMessage: `HTTP ${response.status}`,
        };
      }
      const body = new Uint8Array(await response.arrayBuffer());
      return { ok: true, httpStatus: response.status, contentType, body, errorMessage: null };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, httpStatus: null, contentType: null, body: null, errorMessage: lastError };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
