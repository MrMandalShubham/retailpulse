/**
 * @cosme product-page fetcher. For one product it GETs the server-rendered
 * product page, decodes it from Shift_JIS, and assembles a VERBATIM envelope IN
 * MEMORY (no storage) holding the decoded HTML — the clean step parses JSON-LD
 * + the Shift_JIS info block out of it. Unlike Olive Young (JSON APIs), @cosme
 * is one HTML document per product; there are no side endpoints.
 *
 * The page declares charset=Shift_JIS. The embedded JSON-LD encodes Japanese as
 * \uXXXX escapes (ASCII), so it survives regardless — but the price/size/release
 * info block is raw Shift_JIS, so we must decode the whole page as Shift_JIS.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const COSME_CHARSET = "shift_jis";

export interface FetchBytesResult {
  bytes: Uint8Array | null;
  status: number;
}

export interface CosmeFetchDeps {
  fetchBytes(url: string, userAgent: string): Promise<FetchBytesResult>;
}

/** The in-memory envelope: the decoded product-page HTML, nothing cleaned. */
export interface CosmeEnvelope {
  product_id: string;
  source: string;
  source_url: string;
  fetched_at: string;
  html: string | null;
  http_status: number;
}

export interface CosmeProductResult {
  /** True when the product page returned decodable HTML. */
  ok: boolean;
  envelope: CosmeEnvelope;
  httpStatus: number;
}

function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder(COSME_CHARSET).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export async function fetchCosmeProduct(
  productId: string,
  productUrl: string,
  sourceSlug: string,
  deps: CosmeFetchDeps,
): Promise<CosmeProductResult> {
  const { bytes, status } = await deps.fetchBytes(productUrl, UA);
  const html = bytes ? decode(bytes) : null;
  const envelope: CosmeEnvelope = {
    product_id: productId,
    source: sourceSlug,
    source_url: productUrl,
    fetched_at: new Date().toISOString(),
    html,
    http_status: status,
  };
  return { ok: html !== null && html.length > 0, envelope, httpStatus: status };
}
