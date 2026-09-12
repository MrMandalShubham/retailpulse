# @cosme (Japan) — Discovery (Phase 0)

- **Platform:** @cosme / アットコスメ — https://www.cosme.net
- **Source slug:** `cosme-jp` · **Market:** Japan (`JP`)
- **Strategy:** `pagination` — paginated, server-rendered ranking listings
- **Status:** ✅ working (verified 2026-09-12: 532 products mapped, 14 categories)
- **Command:** `pnpm discover:run cosme-jp` — maps only this source (omit the slug
  to discover every enabled source)

## Why `pagination` (not sitemap / category API)

@cosme has no product JSON API (unlike Olive Young) and its sitemap is
incomplete. The reliable full-catalog path is each category's **ranking listing**,
which is plain server-rendered HTML with `?page=N` pagination. So discovery walks
those pages and scrapes the `/products/{id}/` links. Deterministic, no browser.

## The listing contract (tested)

- **URL template:** `https://www.cosme.net/categories/item/{cat}/ranking/?page={page}`
- **Charset:** the page is **Shift_JIS** (`content-type: text/html; charset=Shift_JIS`) —
  decode bytes as Shift_JIS, not UTF-8.
- **Product links:** `/products/(\d+)/` → product id; product page URL is
  `https://www.cosme.net/products/{id}/`.
- **Per page:** ~13 products. `?page=2..N` pages the ranking. A category is
  crawled until `maxPagesPerCategory` or two consecutive pages add nothing new.
- Product ids are purely numeric (8 digits), disjoint from Olive Young's
  `GA…`-prefixed ids — safe to share the serving layer's `product_id` key.

## Categories crawled (leaf categories, JA)

Skincare + makeup leaves (`discovery_config.categoryNos`): 900 洗顔料 · 901
クレンジング · 902 化粧水 · 1004 乳液 · 1006 美容液 · 904 パック/マスク · 1037
日焼け止め(顔) · 910 アイライナー · 911 マスカラ · 912 アイシャドウ · 1015 口紅 ·
914 チーク · 916 ファンデーション · 920 シャンプー/コンディショナー.
More category ids come from any `/categories/item/{id}/` nav (`<a
href=".../categories/item/{id}/">名前</a>`).

## What gets written

Per discovered product, one lean map row in `discovered_product_pages`
(`(source_id, product_id)` identity, `batch_status = pending`). Idempotent:
re-discovery refreshes url/name, never resets a page's lifecycle. No product
fields are fetched here — that's Phase 1 (`cosme-jp.ingestion.md`).

## Risks & monitoring

Public review site, no login. Category ids and the ranking-URL shape can change;
a break shows as a discovery run finding 0 products. Politeness: 300 ms between
listing pages.
