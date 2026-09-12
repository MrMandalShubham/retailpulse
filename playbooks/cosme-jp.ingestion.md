# @cosme (Japan) — Ingest + Clean (Phase 1)

- **Platform:** @cosme / アットコスメ — https://www.cosme.net
- **Source slug:** `cosme-jp` · **Market:** Japan (`JP`)
- **Chosen method:** **HTML + embedded JSON-LD** (one GET per product), fetched
  in memory, with **Mistral JA→EN translation** at ingest
- **Status:** ✅ working end-to-end (verified 2026-09-12)
- **Command:** `pnpm ingest:api cosme-jp [n]` — takes `pending` rows from the
  Phase 0 map, fetches + cleans + translates them into the clean store, flips
  them to `ingested`. Requires `MISTRAL_API_KEY` in `.env`.

## Methods evaluated

| Method                    | Result                                                                                   | Verdict            |
| ------------------------- | ---------------------------------------------------------------------------------------- | ------------------ |
| Product JSON API          | @cosme exposes none (it's a review aggregator, not a store)                              | ❌ not available   |
| **HTML + JSON-LD**        | Node `fetch` returns 200 (~200–330 KB); JSON-LD gives name/brand/rating/reviews; the Shift_JIS info block gives price/size/release; the ranking line gives rank + category | ✅ **chosen**      |
| Playwright browser render | Would only add the JS-loaded have/want counts; heavy for marginal fields                 | 🟡 not built       |

## The product page (tested contract — no cookies required)

`GET https://www.cosme.net/products/{id}/` with a browser-like `user-agent` and
`accept-language: ja`. **Decode as Shift_JIS.** Two extraction surfaces:

### 1. schema.org JSON-LD (`<script type="application/ld+json">`) — reliable core

The Product node encodes Japanese as `\uXXXX` escapes (ASCII), so it parses
correctly regardless of the page charset:

- `name` → `name_ja` · `brand.name` → `brand_name_ja`
- `aggregateRating.ratingValue` (0–**7** scale, `bestRating: 7`) → `rating_raw`;
  normalized to 0–5 as `rating` (`ratingValue / 7 * 5`)
- `aggregateRating.reviewCount` → `review_count`

There are **no `offers` and no `image`** in the JSON-LD.

### 2. The Shift_JIS info block + ranking line — price/size/release/rank/category

- **`容量・税込価格`** (info-ttl/info-desc): e.g. `3g・1,540円` or
  `20g・550円 / 120g・2,090円` → first price → `price` (JPY), first size →
  `size_value`/`size_unit`, all variants → `price_variants`. NFKC-normalize first
  (fullwidth `150ｇ` → `150g`); split variants on `/`, fields on `・`.
- **`発売日`**: `2021/5/1 …` → `release_date`.
- **Ranking**, two layouts, both handled: `2位口紅` (rank→category) or
  `その他洗顔料ランキング 2位` (category→rank) → `rank_in_category` + `category_ja`.
- **Image:** `og:image` (ASCII CDN URL) → `primary_image`.
- `もってる` (have) / `気になる` (want) counts are JS-loaded (empty in server
  HTML) → left null. No ingredient list on the page → `key_ingredients` empty.

## Translation (JA → EN, at ingest)

For each product the JA `name` / `brand` / `category` are translated in ONE
batched Mistral call (`AI_MODEL`, default `mistral-small-latest`, JSON in/out) →
`name_en` / `brand_name_en` / `category_en`. Both languages are stored.

- **Cached:** a `source_hash` (md5 of the translated JA fields) is stored on the
  row. On re-ingest, if the hash is unchanged the stored English is reused and
  Mistral is **not** called; a source change (hash mismatch) re-translates.
- **Non-fatal:** a failed/empty translation keeps the Japanese and leaves the
  `*_en` columns null — the product is never dropped over a translation hiccup.
- **Cost:** ~1 call/product (~90 tokens); brands/categories repeated within a run
  are memoized to one call.

## What gets written

The fetcher assembles an **in-memory** envelope `{ product_id, source,
source_url, fetched_at, html, http_status }`; nothing raw is persisted. Per
successful product:

| Output                                                             | Content                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `cosme_jp_products` (upsert on `product_id`)                       | one clean typed row — identity, name/brand (JA+EN), category (JA+EN), rank, rating (raw+0–5), review count, price/size/variants (JPY), image, release date, `source_hash` |
| `cosme_jp_product_snapshots` (upsert on `product_id, captured_at`) | that day's rating / review-count / rank / price observation                                      |

`crawl_jobs` logs the run. Recovery from a bad/missing row is a re-run of
`ingest:api` from the map — there is no raw copy to restore.

## Failure semantics

- No decodable HTML / no JSON-LD Product → product NOT written, map row stays
  `pending` (retried next run); the HTTP status is logged.
- Missing info block / ranking / translation → the row still writes with those
  fields null — visible, never silent.

## Distribute (serving layer)

`pnpm distribute` unions `cosme_jp_products` into the shared serving tables via
the `serving_source_products` view, tagged market **Japan / JP**. @cosme gaps
carry through honestly: no stock (so `oos_pct` is null, **not** 100), no discount,
JPY price (so `price_benchmark_usd` stays null; the JPY price lives on
`retail_products.sale_price` with `currency = 'JPY'`), no star histogram (so
sentiment pos/neg/neu are null while the review-weighted score still computes).

## Risks & monitoring

Public HTML — @cosme may change the Shift_JIS markup or JSON-LD; a break shows as
rising null rates / failed runs on `/monitoring`. Rating is a 0–7 scale
normalized to 0–5. Politeness: 600 ms between products.
