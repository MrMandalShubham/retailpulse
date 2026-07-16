import { describe, expect, it } from "vitest";
import {
  fetchOliveYoungProduct,
  gzipEnvelope,
  type PostJsonResult,
} from "../src/ingestion/oliveyoung.js";

/** Mock postJson: canned per-endpoint responses keyed by the endpoint path. */
function mockPost(
  responses: Record<string, PostJsonResult>,
): (url: string, body: unknown) => Promise<PostJsonResult> {
  return async (url: string) => {
    const ep = url.split("/").pop() as string;
    return responses[ep] ?? { ok: false, status: 404, json: null };
  };
}

describe("fetchOliveYoungProduct", () => {
  it("assembles a verbatim envelope from all three endpoints", async () => {
    const post = mockPost({
      "detail-data": { ok: true, status: 200, json: { product: { prdtName: "X", gdsCd: "8809" } } },
      "details-info": { ok: true, status: 200, json: { details: { howToUseText: "apply" } } },
      "review-summary": { ok: true, status: 200, json: { totalStarRate: 4.7, totalReviewCount: 1356 } },
    });

    const res = await fetchOliveYoungProduct("GA1", "https://x/product/detail?prdtNo=GA1", "oy", {
      postJson: post,
    });

    expect(res.ok).toBe(true);
    expect(res.envelope.product_id).toBe("GA1");
    expect(res.envelope.source).toBe("oy");
    expect(res.envelope.source_url).toContain("prdtNo=GA1");
    // All three endpoint payloads stored verbatim, untouched.
    expect(Object.keys(res.envelope.endpoints).sort()).toEqual([
      "detail-data",
      "details-info",
      "review-summary",
    ]);
    expect(res.envelope.http_status).toEqual({
      "detail-data": 200,
      "details-info": 200,
      "review-summary": 200,
    });
    // Bytes round-trip back to the same JSON (nothing lost).
    const parsed = JSON.parse(new TextDecoder().decode(res.bytes));
    expect(parsed.endpoints["review-summary"].totalStarRate).toBe(4.7);
  });

  it("still saves when review-summary fails (detail-data is essential)", async () => {
    const post = mockPost({
      "detail-data": { ok: true, status: 200, json: { product: { prdtName: "X" } } },
      "details-info": { ok: true, status: 200, json: { details: {} } },
      "review-summary": { ok: false, status: 500, json: null },
    });

    const res = await fetchOliveYoungProduct("GA2", "https://x?prdtNo=GA2", "oy", { postJson: post });

    expect(res.ok).toBe(true); // detail-data succeeded → envelope is worth saving
    expect(res.envelope.endpoints["review-summary"]).toBeNull();
    expect(res.envelope.http_status["review-summary"]).toBe(500);
  });

  it("reports failure when the essential endpoint fails", async () => {
    const post = mockPost({
      "detail-data": { ok: false, status: 500, json: null },
      "details-info": { ok: false, status: 500, json: null },
      "review-summary": { ok: false, status: 500, json: null },
    });
    const res = await fetchOliveYoungProduct("GA3", "https://x?prdtNo=GA3", "oy", { postJson: post });
    expect(res.ok).toBe(false);
  });

  it("gzipEnvelope compresses the raw bytes (available, but not used by ingestion)", () => {
    const big = new TextEncoder().encode(JSON.stringify({ a: "z".repeat(2000) }));
    const gz = gzipEnvelope(big);
    expect(gz.byteLength).toBeLessThan(big.byteLength);
  });
});
