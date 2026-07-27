# Olive Young Global — Ingest + Clean (Phase 1)

- **Platform:** Olive Young Global — https://global.oliveyoung.com
- **Source slug:** `oliveyoung-global`
- **Chosen method:** **direct API** (the site's own product JSON endpoints), fetched in memory
- **Status:** ✅ working end-to-end (verified 2026-07-16: JSON + rating captured)
- **Command:** `pnpm ingest:api oliveyoung-global [n]` — takes `pending` rows from the Phase 0 map, fetches + cleans them straight into the clean store, flips them to `ingested`

## Methods evaluated

| Method                    | Result                                                                                         | Verdict                             |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------- |
| Plain HTML GET (+ parser) | 200 OK, 422 KB — but only name/image in meta; **price, rating, stock filled by JS after load** | ❌ incomplete as a data source      |
| Playwright browser render | Works (fires the same APIs), ~5–8 s/product, Chromium overhead, scrape-from-DOM fragility      | 🟡 last-resort fallback (not built) |
| **Direct API**            | Complete structured data, ~2 s/product, plain HTTP, no cookies/session                         | ✅ **chosen**                       |

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
{
  "filterYn": "N",
  "prdtNo": "<id>",
  "prdtGbnCode": "<from detail-data, default 10>",
  "movReviewYn": "N",
  "photoReviewYn": "N",
  "optnYn": "N",
  "transUseYn": "N",
  "filterUseYn": "Y"
}
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

## What gets written

The fetcher assembles the three endpoint responses into an **in-memory**
envelope `{ product_id, source, source_url, fetched_at, endpoints, http_status }`
and hands it straight to the clean transform. Nothing raw is persisted. Per
successful product:

| Output                                                                      | Content                                                                                                                                                                       |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oliveyoung_global_products` (upsert on `product_id`)                       | one clean typed row — identity, brand, category levels, prices, parsed name/size/set, key ingredients, images, rating, and nested JSONB (options, thumbnails, star breakdown) |
| `oliveyoung_global_product_snapshots` (upsert on `product_id, captured_at`) | that day's price/rating/review-count/stock observation                                                                                                                        |

The `crawl_jobs` row logs the run (started/finished/status); it holds no
per-product pointers. Recovery from a bad/missing row is a re-run of
`ingest:api` from the map — there is no raw copy to restore.

## Failure semantics

- `detail-data` fails → product NOT written, map row stays `pending` (retried
  next run); the failure + endpoint statuses are logged.
- `details-info` / `review-summary` fail → the clean row still writes with those
  fields left null and the HTTP status logged — visible, never silent.

## Risks & monitoring

Internal (undocumented) API — OY may change it without notice. Covered by:
per-endpoint HTTP statuses logged on every fetch (a break shows as rising null
rates / failed runs on the `/monitoring` dashboard), the Playwright re-capture
procedure above, and re-runnability from the map. Politeness: 500 ms between
products.

## Data coverage vs the report card

Captured: identity, brand, category, prices, size (in name/option), barcode,
images, ingredients, how-to-use, positioning text, rating + review count,
provenance URL. Known non-website gaps (all sources, not an API limitation):
parent company, OEM/manufacturer — Phase 7 enrichment.
