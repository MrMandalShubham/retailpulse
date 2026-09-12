# DIP Engine — Project Context

This file keeps AI-assisted sessions aligned. Read it before making changes.

## What DIP Engine is

A data ingestion platform for global beauty-product intelligence. As of the
2026-07 cleanup it is a **storage-free 2-step engine** — the "middle chain"
(transform → AI → promotion → facts → enrichment → normalized core 8) was
retired, and then the raw storage layer (object storage + `raw_documents`) was
dropped too, because scraping the source's own APIs already yields clean,
structured data. Ingestion fetches each product's data IN MEMORY and writes the
clean per-platform store directly — that store is the end product.

**Two approved sources today**, each with its own per-platform store:
- **Olive Young Global** (`oliveyoung-global`) — Korea (Global) / market `XG`.
  Ingested from the site's own JSON APIs.
- **@cosme** (`cosme-jp`) — Japan / market `JP`. Ingested from server-rendered
  HTML + embedded JSON-LD (Shift_JIS), with Mistral JA→EN translation at ingest
  (both languages stored, cached by source hash). @cosme is a review aggregator:
  no stock/coupon, JPY reference price (often absent), 0–7 rating normalized to
  0–5. See `playbooks/cosme-jp.*.md`.

```
Phase 0                Phase 1
DISCOVER        ──►     INGEST + CLEAN        ──►  oliveyoung_global_products
 (the map)             (fetch API in memory,       (THE end product)
                        clean → typed row)        + oliveyoung_global_product_snapshots
```

1. **Discover** — map a source's full catalog into `discovered_product_pages`.
2. **Ingest + Clean** — for each pending product, fetch its JSON envelope from
   the source's own APIs (detail-data + details-info + review-summary) in
   memory, transform it into ONE clean typed row in the per-platform store, and
   append a daily time-series snapshot. Nothing raw is persisted; the map can
   always re-drive a fresh fetch. Flips the map row pending → ingested.

## The schema: core tables

Defined in `packages/db/src/schema/`, migrated from `packages/db/migrations/`.

- `sources`, `crawl_jobs` — ingestion-control layer. `crawl_jobs` is the
  fetch-run log (one row per `ingest:api` run; started/finished/status). No
  `raw_documents` — the raw layer was dropped (migration `0017`).
- `discovery_runs`, `discovered_product_pages` — Phase 0 map (lean 8 columns;
  identity `(source_id, product_id)`; `batch_status` lifecycle
  pending → ingested).
- `oliveyoung_global_products` (+ `_snapshots`) — Olive Young's clean per-platform
  end product. Fully typed/decoded row per product; nested data (options, images,
  review breakdown) as cleaned JSONB.
- `cosme_jp_products` (+ `_snapshots`) — @cosme's clean per-platform store.
  Japanese fields stored as `*_ja` + translated `*_en`; rating kept raw (0–7) and
  normalized (0–5); JPY reference price + variants; `source_hash` caches the
  translation. Added migration `0024`.
- **Per-platform by design** — each source exposes different fields, so every new
  source gets its own `<platform>_products` table (+ `_snapshots`). The `_snapshots`
  tables are append-only daily observations keyed `(product_id, captured_at)`;
  they power dashboard trends, momentum, and price-drop / OOS alerts.

## Architecture rules

- **No raw layer, no object storage.** Ingestion holds the API envelope in
  memory only; the clean transform runs in the same pass. The only durable
  outputs are the clean store + snapshots (and the discovery map).
- **Re-runnable, not archived.** There is no raw copy to fall back on — if a
  clean row is ever wrong/missing, re-run `ingest:api` from the map, which
  re-fetches and re-cleans. A failed fetch leaves the map row `pending` for the
  next run.
- text + CHECK constraints instead of native enums. Closed vocabularies live in
  `@dip/domain`; use `inList()` from `packages/db/src/schema/helpers.ts`.
- The clean store is idempotent on `product_id`; snapshots are idempotent on
  `(product_id, captured_at)`. Re-running `ingest:api` refreshes both.
- Per-platform playbooks in `playbooks/<slug>.<flow>.md` record the tested
  discovery + ingestion contracts (endpoints, request bodies, method choice).

## Commands

- `pnpm discover:run [slug]` — map the catalog. No slug = every enabled source;
  a slug (`cosme-jp`) maps just that one. Strategy per source: Olive Young uses
  the category-crawl JSON API, @cosme the `pagination` HTML crawl.
- `pnpm ingest:api <slug> [n]` — fetch + clean n pending products straight into
  that source's clean store + snapshots (idempotent; reads
  `discovered_product_pages` pending directly). Dispatches by slug:
  `oliveyoung-global` (JSON APIs) or `cosme-jp` (HTML+JSON-LD + Mistral
  translation; needs `MISTRAL_API_KEY`). Default slug `oliveyoung-global`.
- `pnpm distribute` — rebuild the dashboard serving tables from ALL clean stores
  (see below). Idempotent; safe to run after every ingest.
- `pnpm db:seed` — bootstrap the approved sources + their discovery_config.

## Dashboard serving layer (derived)

The Retail dashboard reads a set of **derived** tables that are pure projections
of the per-platform clean stores (+ snapshots), rebuilt by `pnpm distribute`
(migration `0018`, schema `packages/db/src/schema/serving.ts`). Distribute is
**multi-source**: step 0 defines a view `serving_source_products` that UNIONs
every clean store into one common shape with a per-row market (Olive Young →
Korea (Global)/`XG`, @cosme → Japan/`JP`), and every projection reads that view —
so a new platform is wired in by adding a branch to the view.

- `brands`, `categories`, `markets` — dimensions (distinct brands/categories;
  markets holds `XG` "Korea (Global)" 🇰🇷 and `JP` "Japan" 🇯🇵. The `XG` code
  stays for Olive Young's cross-border storefront — `KR` is a separate domestic
  row used by the news feature).
- `retail_products` — flat 1:1 mirror of the clean store (leaderboard).
- `products_master` — normalized canonical hub (FKs to brands/categories);
  enrichment columns the source lacks (skin types, SPF, texture, price segment,
  multi-currency benchmarks) stay null.
- `product_ingredients` — `(product_id, product_name, ingredients text[])` from
  `key_ingredients` (denormalized array by design — no separate names table).
- `voice_pulse_sentiment` — brand × month × market rating-derived proxy
  (positive/negative/neutral from the star breakdown; NOT text NLP).
- `product_category_share`, `product_sales_history`, `brand_market_share` —
  share/sales tables. The source has NO sales, so `units_sold` + the `*_units_*`
  / `*_share_pct` columns hold a **review-volume proxy** (review_count as the
  demand weight); all revenue columns (`revenue`, `*_revenue`,
  `market_share_pct`) stay null.
- `retail_pulse_shelf_share` — weekly per-product presence. `oos_pct` (from
  stock_qty) and `promo_pct` (from discount_rate) are REAL for Olive Young;
  `shelf_share_pct` is a review-volume proxy and `facings` is null (no planogram
  source). @cosme has no stock, so its `oos_pct` is **null** (not 100 = OOS).

Per-market honesty across sources: @cosme rows carry `currency = 'JPY'` on
`retail_products.sale_price` and leave `price_benchmark_usd` null (no USD price);
having no star histogram, their sentiment pos/neg/neu are null while the
review-weighted score still computes.

Nothing here is a source of truth — it can be dropped and re-derived. **Caveat:**
across the proxy tables, `units_sold` / `mention_count` / `*_share_pct` are
review-derived popularity, not real sales — frame them as such downstream.

## Codebase layout

- `apps/api` — Fastify 5 backend. Live modules: `health`, `ingestion`
  (ingestion-control monitoring: sources + crawl_jobs), `monitoring` (the
  `/monitoring` observability console, config-driven over the tables).
- `apps/worker` — the engine. `discover.ts`, `ingest-api.ts`; `discovery/`,
  `ingestion/` (fetcher + storage-free fetch+clean pipeline), `platform/`
  (the pure envelope→clean transform).
- `packages/config` — zod-validated env loader (only place reading process.env).
- `packages/domain` — pure shared contracts (no runtime deps).
- `packages/db` — Drizzle schema + migrations + pg client.

Tooling: pnpm workspaces, TypeScript (strict, ESM/NodeNext), ESLint + Prettier,
Vitest, docker-compose (Postgres only). Deploy kit in `deploy/`. Planning
material in `Breakdown/`, `DB/`, `Docs/` is gitignored.

## History: retired middle chain + dropped raw layer (2026-07)

- **Middle chain** — removed `@dip/ai`, `@dip/enrichment`, `@dip/promotion`;
  worker `transform/`, `facts/`, `ai-review/`, `render/`; the core-8 +
  staging/AI/promotion/facts/enrichment/report/media tables (migration `0013`).
  Restorable via git tag `pre-retire-middle-chain`.
- **Raw layer** — removed `@dip/storage`, in-memory-only fetching, and the
  `raw_documents` table + `raw_document_id` column (migration `0017`). The clean
  store is now written directly. Restorable via git tag
  `pre-retire-middle-chain` (raw code) — but the map + snapshots make a re-fetch
  the intended recovery path.

Rationale: the middle chain cleaned scraped HTML; direct-API ingestion made it
redundant. The raw layer then only added an object-storage round-trip (and MinIO
ops pain) with no effect on the final clean row.

## Conventions

- Schema naming: snake_case tables/columns.
- Migrations: `pnpm build` (domain first), then `pnpm db:generate --name …`;
  never edit applied migrations. Internal packages resolve from `dist/` — run
  `pnpm build` after changing them.
- Approved sources: Olive Young Global (`oliveyoung-global`) and @cosme
  (`cosme-jp`). Do NOT add other live sources without explicit approval.
