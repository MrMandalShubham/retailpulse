import { describe, expect, it } from "vitest";
import {
  fetchOliveYoungProduct,
  gzipEnvelope,
  type GetHtmlResult,
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

const htmlOk: GetHtmlResult = { status: 200, body: new TextEncoder().encode("<html>raw</html>") };
const htmlFail: GetHtmlResult = { status: 403, body: null };
const getHtml = (result: GetHtmlResult) => async () => result;

describe("fetchOliveYoungProduct", () => {
  it("assembles a verbatim envelope from all three endpoints + page html", async () => {
    const post = mockPost({
      "detail-data": {
        ok: true,
        status: 200,
        json: { product: { prdtName: "X", prdtGbnCode: "10" } },
      },
      "details-info": { ok: true, status: 200, json: { details: { howToUseText: "apply" } } },
      "review-summary": { ok: true, status: 200, json: { totalStarRate: 4.7, totalReviewCount: 1356 } },
    });

    const res = await fetchOliveYoungProduct("GA1", "https://x/product/detail?prdtNo=GA1", "oy", {
      postJson: post,
      getHtml: getHtml(htmlOk),
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
      "page-html": 200,
    });
    // Raw page HTML captured alongside.
    expect(res.htmlBytes).not.toBeNull();
    expect(res.htmlStatus).toBe(200);
    // Bytes round-trip back to the same JSON (nothing lost).
    const parsed = JSON.parse(new TextDecoder().decode(res.bytes));
    expect(parsed.endpoints["review-summary"].totalStarRate).toBe(4.7);
  });

  it("sends the captured review-summary body with prdtGbnCode from detail-data", async () => {
    const bodies: Record<string, unknown> = {};
    const post = async (url: string, body: unknown): Promise<PostJsonResult> => {
      const ep = url.split("/").pop() as string;
      bodies[ep] = body;
      if (ep === "detail-data")
        return { ok: true, status: 200, json: { product: { prdtGbnCode: "20" } } };
      return { ok: true, status: 200, json: {} };
    };
    await fetchOliveYoungProduct("GA9", "https://x?prdtNo=GA9", "oy", {
      postJson: post,
      getHtml: getHtml(htmlOk),
    });
    expect(bodies["review-summary"]).toMatchObject({
      prdtNo: "GA9",
      prdtGbnCode: "20", // threaded from detail-data, not hardcoded
      filterYn: "N",
      filterUseYn: "Y",
    });
  });

  it("still saves when review-summary or the page html fails (detail-data is essential)", async () => {
    const post = mockPost({
      "detail-data": { ok: true, status: 200, json: { product: { prdtName: "X" } } },
      "details-info": { ok: true, status: 200, json: { details: {} } },
      "review-summary": { ok: false, status: 500, json: null },
    });

    const res = await fetchOliveYoungProduct("GA2", "https://x?prdtNo=GA2", "oy", {
      postJson: post,
      getHtml: getHtml(htmlFail),
    });

    expect(res.ok).toBe(true); // detail-data succeeded → envelope is worth saving
    expect(res.envelope.endpoints["review-summary"]).toBeNull();
    expect(res.envelope.http_status["review-summary"]).toBe(500);
    expect(res.htmlBytes).toBeNull(); // page fetch failed → no .html artifact
    expect(res.envelope.http_status["page-html"]).toBe(403);
  });

  it("reports failure when the essential endpoint fails", async () => {
    const post = mockPost({
      "detail-data": { ok: false, status: 500, json: null },
      "details-info": { ok: false, status: 500, json: null },
      "review-summary": { ok: false, status: 500, json: null },
    });
    const res = await fetchOliveYoungProduct("GA3", "https://x?prdtNo=GA3", "oy", {
      postJson: post,
      getHtml: getHtml(htmlOk),
    });
    expect(res.ok).toBe(false);
  });

  it("gzipEnvelope compresses the raw bytes (available, but not used by ingestion)", () => {
    const big = new TextEncoder().encode(JSON.stringify({ a: "z".repeat(2000) }));
    const gz = gzipEnvelope(big);
    expect(gz.byteLength).toBeLessThan(big.byteLength);
  });
});
