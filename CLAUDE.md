# DIP Engine — Project Context

This file keeps AI-assisted sessions aligned. Read it before making changes.

## What DIP Engine is

A data ingestion platform (ELT) for global beauty-product intelligence. As of
the 2026-07 architecture cleanup it is a **lean 3-step engine** — the "middle
chain" (transform → AI → promotion → facts → enrichment → normalized core 8)
was retired because scraping the source's own APIs already yields clean,
structured data, so the flat per-platform store is the end product.

```
Phase 0            Phase 1              Clean-load
DISCOVER    ──►    INGEST (raw API)  ──►  TRANSFORM+CLEAN  ──►  oliveyoung_global_products
 (the map)         (raw JSON+HTML)        (typed, decoded)       (THE end product)
```

1. **Discover** — map a source's full catalog into `discovered_product_pages`.
2. **Ingest** — fetch each product's raw JSON envelope from the source's own
   APIs (+ page HTML as evidence), stored verbatim + UNCOMPRESSED in object
   storage; a pointer row lands in `raw_documents`.
3. **Clean-load** — transform each raw envelope into ONE clean typed row in the
   per-platform store (`<platform>_products`).

## The schema: 6 tables

Defined in `packages/db/src/schema/`, migrated from `packages/db/migrations/`.

- `sources`, `crawl_jobs`, `raw_documents` — raw ELT layer.
- `discovery_runs`, `discovered_product_pages` — Phase 0 map (lean 8 columns;
  identity `(source_id, product_id)`; `batch_status` lifecycle
  pending → ingested).
- `oliveyoung_global_products` — the clean per-platform end product. Fully
  typed/decoded row per product; nested data (options, images, review
  breakdown) as cleaned JSONB. **Per-platform by design** — each source's API
  exposes different fields, so the next platform gets its own
  `<platform>_products` table (e.g. `sephora_us_products`).

## Architecture rules

- **Raw is immutable + verbatim.** Raw envelopes/HTML land in object storage
  untouched; only the clean-load reads them and writes typed rows.
- **Gzip is deferred.** Raw is stored UNCOMPRESSED through the flow; gzip is
  built (`gzipEnvelope`) but triggered only as a final end-of-flow archival
  step (never during ingestion/clean-load).
- text + CHECK constraints instead of native enums. Closed vocabularies live in
  `@dip/domain`; use `inList()` from `packages/db/src/schema/helpers.ts`.
- The clean store is idempotent on `product_id` — re-running `platform:load`
  refreshes rows from the latest envelope.
- Per-platform playbooks in `playbooks/<slug>.<flow>.md` record the tested
  discovery + ingestion contracts (endpoints, request bodies, method choice).

## Commands

- `pnpm discover:run` — map the catalog (category-crawl API).
- `pnpm ingest:api oliveyoung-global [n]` — fetch n pending products' raw
  envelopes (idempotent; reads `discovered_product_pages` pending directly).
- `pnpm platform:load [n]` — clean-load raw envelopes into the clean store.
- `pnpm db:seed` — bootstrap the `oliveyoung-global` source + discovery_config.

## Codebase layout

- `apps/api` — Fastify 5 backend. Live modules: `health`, `ingestion`
  (raw-layer monitoring), `monitoring` (the `/monitoring` observability
  console, config-driven over the 6 tables).
- `apps/worker` — the engine. `discover.ts`, `ingest-api.ts`,
  `platform-load.ts`; `discovery/`, `ingestion/`, `platform/`.
- `packages/config` — zod-validated env loader (only place reading process.env).
- `packages/domain` — pure shared contracts (no runtime deps).
- `packages/db` — Drizzle schema + migrations + pg client.
- `packages/storage` — S3-compatible adapter (DO Spaces prod / MinIO local).

Tooling: pnpm workspaces, TypeScript (strict, ESM/NodeNext), ESLint + Prettier,
Vitest, docker-compose (MinIO). Planning material in `Breakdown/`, `DB/`,
`Docs/` is gitignored.

## The retired middle chain (2026-07)

Removed: `@dip/ai`, `@dip/enrichment`, `@dip/promotion`; worker `transform/`,
`facts/`, `ai-review/`, `render/`, and the `promote`/`enrich`/`report`/old
`ingest` CLIs; the core-8 + staging/AI/promotion/facts/enrichment/report/media
tables (migration `0013`). **Fully restorable** via the git tag
`pre-retire-middle-chain` (code) — the dropped tables held only derived data,
regenerable from the retained raw envelopes.

Rationale: the middle chain existed to clean scraped HTML into report-ready
data; direct-API ingestion made that redundant. If a cross-platform normalized
model is needed later (e.g. for comparison reports), restore from the tag.

## Conventions

- Schema naming: snake_case tables/columns.
- Migrations: `pnpm build` (domain first), then `pnpm db:generate --name …`;
  never edit applied migrations. Internal packages resolve from `dist/` — run
  `pnpm build` after changing them.
- Approved source: Olive Young Global. Do NOT add other live sources without
  explicit approval.
