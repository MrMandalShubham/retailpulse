# Olive Young Global — Raw Ingestion (Phase 1)

- **Platform:** Olive Young Global — https://global.oliveyoung.com
- **Source slug:** `oliveyoung-global`
- **Chosen method:** **direct API** (the site's own product JSON endpoints) + raw page HTML as evidence
- **Status:** ✅ working end-to-end (verified 2026-07-16: JSON + HTML + rating captured)
- **Command:** `pnpm ingest:api oliveyoung-global [n]` — takes `pending` rows from the Phase 0 map, flips them to `ingested`

## Methods evaluated

| Method | Result | Verdict |
|---|---|---|
| Plain HTML GET (+ parser) | 200 OK, 422 KB — but only name/image in meta; **price, rating, stock filled by JS after load** | ❌ incomplete as a data source; kept as the **evidence artifact** |
| Playwright browser render | Works (fires the same APIs), ~5–8 s/product, Chromium overhead, scrape-from-DOM fragility | 🟡 **fallback only** (pipeline exists from Phase 10: `pnpm render:run`) |
| **Direct API** | Complete structured data, ~2 s/product, plain HTTP, no cookies/session | ✅ **chosen** |

## The product APIs (tested contracts — no cookies required)

All: `POST https://global.oliveyoung.com/product/<endpoint>` with headers
`content-type: application/json`, browser-like `user-agent`,
`origin: https://global.oliveyoung.com`, `referer: https://global.oliveyoung.com/`.

### 1. `detail-data` (ESSENTIAL — run first)
```json
{ "prdtNo": "<id>", "langCode": "en", "dlvCntry": "10", "mrgnCntryCode": "10" }
```
→ name (EN+KR), brand (+`brandNo`), full category path (EN+KR), regular/sale
price + discount %, promotion window, barcode/GTIN (`gdsCd`), images
(`thumbnailList`), stock, options, member-grade pricing.
Also yields **`prdtGbnCode`** — required by the review call below.

### 2. `details-info`
Same body as `detail-data`.
→ `dtlDesc` (description/detail images), `ftrdIngrdText` (key ingredients),
`howToUseText`, `whyWeLoveItText`, `sellingPointText`.

### 3. `review-summary`
```json
{ "filterYn": "N", "prdtNo": "<id>", "prdtGbnCode": "<from detail-data, default 10>",
  "movReviewYn": "N", "photoReviewYn": "N", "optnYn": "N",
  "transUseYn": "N", "filterUseYn": "Y" }
```
→ `totalStarRate`, `totalReviewCount`, star breakdown (`scores`), attribute
scores (`evltScores`).
**History:** simple bodies return HTTP 500. This exact body was captured from
the live app via Playwright request interception on 2026-07-16
(`scratchpad capture-review-request.cjs` pattern: `page.on("request")` filter
on the endpoint, read `postData()`). If OY changes the contract, re-capture the
same way.

### Endpoints deliberately skipped (V1)
`calculate` (cart math), `emblm-info` (badges), `relation-list` (related
products), `review-list` / `review-media-list` (individual review texts — V1
stores monthly aggregates only).

## What gets stored (verbatim, uncompressed)

Per product, two artifacts under
`raw/oliveyoung-global/{yyyy-mm-dd}/{crawl_job_id}/`:

| Artifact | Content | Size |
|---|---|---|
| `{prdtNo}.json` | envelope: `{ product_id, source, source_url, fetched_at, endpoints: { detail-data, details-info, review-summary }, http_status }` — every response verbatim | ~10–40 KB |
| `{prdtNo}.html` | raw product page as served (evidence only — adds no data; keep-or-drop decision open) | ~420 KB |

Each artifact gets its own `raw_documents` pointer row (checksum, bytes,
http_status). **No gzip during the flow** — compression is a deferred
end-of-flow archival step (`gzipEnvelope()` exists but is never called by
ingestion).

## Failure semantics
- `detail-data` fails → product NOT stored, map row stays `pending` (retried
  next run), error recorded in `raw_documents`.
- `details-info` / `review-summary` / HTML fail → envelope still saves with the
  endpoint `null` and its HTTP status recorded — visible, never silent.

## Risks & monitoring
Internal (undocumented) API — OY may change it without notice. Covered by:
per-endpoint `http_status` in every envelope (breakage shows on the next run's
dashboard), the Playwright re-capture procedure above, and the full browser
fallback (`render:run`). Politeness: 500 ms between products.

## Data coverage vs the report card
Captured: identity, brand, category, prices, size (in name/option), barcode,
images, ingredients, how-to-use, positioning text, rating + review count,
provenance URL. Known non-website gaps (all sources, not an API limitation):
parent company, OEM/manufacturer — Phase 7 enrichment.
