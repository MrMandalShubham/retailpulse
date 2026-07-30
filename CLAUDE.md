# DIP Engine — Project Context

This file keeps AI-assisted sessions aligned. Read it before making changes.

## What DIP Engine is

A data ingestion platform for global beauty-product intelligence. As of the
2026-07 cleanup it is a **storage-free 2-step engine** — the "middle chain"
(transform → AI → promotion → facts → enrichment → normalized core 8) was
retired, and then the raw storage layer (object storage + `raw_documents`) was
dropped too, because scraping the source's own APIs already yields clean,
structured data. Ingestion fetches each product's API envelope IN MEMORY and
writes the clean per-platform store directly — that store is the end product.

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

## The schema: 5 tables

Defined in `packages/db/src/schema/`, migrated from `packages/db/migrations/`.

- `sources`, `crawl_jobs` — ingestion-control layer. `crawl_jobs` is the
  fetch-run log (one row per `ingest:api` run; started/finished/status). No
  `raw_documents` — the raw layer was dropped (migration `0017`).
- `discovery_runs`, `discovered_product_pages` — Phase 0 map (lean 8 columns;
  identity `(source_id, product_id)`; `batch_status` lifecycle
  pending → ingested).
- `oliveyoung_global_products` — the clean per-platform end product. Fully
  typed/decoded row per product; nested data (options, images, review
  breakdown) as cleaned JSONB. **Per-platform by design** — each source's API
  exposes different fields, so the next platform gets its own
  `<platform>_products` table (e.g. `sephora_us_products`).
- `oliveyoung_global_product_snapshots` — append-only daily observations
  (price/rating/review-count/stock) keyed `(product_id, captured_at)`; powers
  dashboard trends, momentum, and price-drop / OOS alerts.

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

- `pnpm discover:run` — map the catalog (category-crawl API).
- `pnpm ingest:api oliveyoung-global [n]` — fetch + clean n pending products
  straight into the clean store + snapshots (idempotent; reads
  `discovered_product_pages` pending directly).
- `pnpm distribute` — rebuild the dashboard serving tables from the clean store
  (see below). Idempotent; safe to run after every ingest.
- `pnpm db:seed` — bootstrap the `oliveyoung-global` source + discovery_config.

## Dashboard serving layer (derived)

The Retail dashboard reads a set of **derived** tables that are pure projections
of `oliveyoung_global_products` (+ snapshots), rebuilt by `pnpm distribute`
(migration `0018`, schema `packages/db/src/schema/serving.ts`):

- `brands`, `categories`, `markets` — dimensions (distinct brands/categories;
  markets seeded with one `XG` "Global (Cross-border)" row, since Olive Young
  Global is a single cross-border storefront).
- `retail_products` — flat 1:1 mirror of the clean store (leaderboard).
- `products_master` — normalized canonical hub (FKs to brands/categories);
  enrichment columns the source lacks (skin types, SPF, texture, price segment,
  multi-currency benchmarks) stay null.
- `product_ingredients` — `(product_id, product_name, ingredients text[])` from
  `key_ingredients` (denormalized array by design — no separate names table).
- `voice_pulse_sentiment` — brand × month × market rating-derived proxy
  (positive/negative/neutral from the star breakdown; NOT text NLP).

Nothing here is a source of truth — it can be dropped and re-derived. Known gap:
`product_sales_history` isn't built (no units/revenue in the source).

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
- Approved source: Olive Young Global. Do NOT add other live sources without
  explicit approval.
