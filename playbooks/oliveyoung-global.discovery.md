# Olive Young Global — Discovery (Phase 0)

- **Platform:** Olive Young Global — https://global.oliveyoung.com
- **Source slug:** `oliveyoung-global`
- **Chosen method:** `category_crawl` (the site's own category product-data API)
- **Status:** ✅ in production — full catalog mapped (16,061 products, 2026-07-14)
- **Command:** `pnpm discover:run` (idempotent; re-run any time to refresh the map)

## Methods evaluated

| Method | Result | Verdict |
|---|---|---|
| `sitemap` (robots.txt → sitemap.xml) | Only ~500 product URLs ≈ **3% of the catalog** — OY exposes just a curated SEO subset | ❌ rejected (kept as generic strategy for other sites) |
| `category_crawl` (internal category API) | **16,061 unique products** across all 14 categories; per-category counts match the site's own displayed "N items" exactly | ✅ **chosen** |

## The category API (tested contract)

```
POST https://global.oliveyoung.com/display/category/product-data/
content-type: application/json
```

Body (per page; site-specific constants come from `requestTemplate` merging):

```json
{
  "accParam": "", "langCode": "en", "previewDate": "", "encKey": "", "encText": "",
  "dlvCntry": "10", "mrgnCntryCode": "", "attrValNo": "",
  "prdtSortStdrCode": "10", "attrValNoList": {}, "brandNoList": [],
  "ctgrNoList": [], "eventSlprcDscntRt": [], "reviewScore": [], "scrollY": 0,
  "ctgrNo": "<category id>", "pageNum": 1, "rowsPerPage": "100"
}
```

Response: `hits.hit[].fields` → `{ prdtNo, prdtName, brandName, ctgrName, ... }`;
`hits.found` = category total. Page until `hits.hit` returns fewer than
`rowsPerPage`. No cookies/session required. Politeness delay: 250 ms/page.
Full-catalog run ≈ 2.5 minutes.

Product URL construction: `https://global.oliveyoung.com/product/detail?prdtNo=` + `prdtNo`.

## Category IDs (all 14, verified 2026-07-12)

| Category | ctgrNo | Products* |
|---|---|---|
| Skincare | 1000000008 | 4,121 |
| Makeup | 1000000031 | 2,142 |
| Bath & Body | 1000000052 | 923 |
| Hair | 1000000070 | 1,072 |
| Masks | 1000000003 | 1,312 |
| Sun Care | 1000000011 | 845 |
| K-Pop | 1000000162 | 1,584 |
| Makeup Brush & Tools | 1000000087 | 904 |
| Accessories | 1000000083 | 78 |
| Wellness | 1000000095 | 993 |
| Men's Care | 1000000119 | 1,164 |
| Supplements | 1000000134 | 1,247 |
| Food & Drink | 1000000137 | 1,003 |
| Special Value Sets | 1000000151 | 122 |

\* Point-in-time counts; products appear in multiple categories — unique total
is lower than the column sum (16,061 unique on 2026-07-14). The catalog moves
daily; re-discovery upserts by `(source_id, product_id)` so re-runs are safe.

## Runtime config (lives in `sources.discovery_config`)

```json
{
  "strategy": "category_crawl",
  "categoryApiUrl": "https://global.oliveyoung.com/display/category/product-data/",
  "categoryNos": ["1000000008", "1000000031", "1000000052", "1000000070",
                   "1000000003", "1000000011", "1000000162", "1000000087",
                   "1000000083", "1000000095", "1000000119", "1000000134",
                   "1000000137", "1000000151"],
  "productUrlBase": "https://global.oliveyoung.com/product/detail?prdtNo=",
  "rowsPerPage": 100
}
```

## Output

Lean 8-column map in `discovered_product_pages` (id, source_id, **product_id**
= `prdtNo`, product_name, product_url, normalized_url, batch_status,
created_at). Identity/dedup key: `(source_id, product_id)`.
