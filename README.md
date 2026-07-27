# DIP Engine

A data ingestion platform for global beauty-product intelligence. DIP Engine
maps a source's catalog, then fetches each product's own JSON APIs and cleans
the result into one typed row per product — the clean per-platform store is the
end product that powers comparison, dashboards, and reports.

**Architecture: a storage-free 2-step engine.**

```
Phase 0                Phase 1
DISCOVER        ──►     INGEST + CLEAN        ──►  oliveyoung_global_products
 (the map)             (fetch API in memory,       (THE end product)
                        clean → typed row)        + oliveyoung_global_product_snapshots
```

1. **Discover** — map the source's full catalog into `discovered_product_pages`
   (identity `(source_id, product_id)`; `batch_status` pending → ingested).
2. **Ingest + Clean** — for each pending product, fetch its JSON envelope from
   the source's own APIs (detail-data + details-info + review-summary) **in
   memory**, transform it into one clean typed row (HTML entities decoded,
   prices as numbers, Y/N → boolean, category path split, name/ingredients
   parsed), and append a daily time-series snapshot. Nothing raw is persisted —
   the map can always re-drive a fresh fetch.

There is no object storage and no raw layer. Earlier versions landed raw
envelopes in DigitalOcean Spaces / MinIO and a `raw_documents` table before a
separate clean-load; that round-trip had no effect on the final clean row, so it
was removed (migration `0017`). An even earlier "middle chain" (AI transform →
promotion → normalized core-8) was retired first (migration `0013`). Both are
restorable via the git tag `pre-retire-middle-chain`.

## Repository layout

```
apps/
  api/          Fastify backend (health + ingestion/monitoring consoles)
  worker/       The engine: discover + ingest-clean CLIs, discovery/ingestion/platform code
packages/
  config/       @dip/config — zod-validated environment loader (single env source of truth)
  domain/       @dip/domain — shared domain contracts (pure types, no runtime deps)
  db/           @dip/db — Drizzle schema, pg client, SQL migrations, seed script
deploy/         DigitalOcean deploy kit (setup script, env template, cron, guide)
playbooks/      Per-source tested discovery + ingestion contracts
```

## The schema: 5 tables

- `sources`, `crawl_jobs` — ingestion-control layer. `crawl_jobs` is the
  fetch-run log (one row per `ingest:api` run).
- `discovery_runs`, `discovered_product_pages` — the Phase 0 catalog map.
- `oliveyoung_global_products` — the clean per-platform end product (one typed
  row per product; nested data as cleaned JSONB). **Per-platform by design** —
  each source's API exposes different fields, so the next platform gets its own
  `<platform>_products` table.
- `oliveyoung_global_product_snapshots` — append-only daily observations
  (price/rating/review-count/stock), keyed `(product_id, captured_at)`.

## Prerequisites

- Node.js >= 22
- pnpm >= 9
- Docker Desktop (for local Postgres) — or any reachable Postgres URL

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Create your local environment file
cp .env.example .env        # PowerShell: Copy-Item .env.example .env

# 3. Start local Postgres
docker compose up -d

# 4. Build workspace packages (internal packages resolve from dist/)
pnpm build

# 5. Apply database migrations
pnpm db:migrate

# 6. Seed the approved source (Olive Young Global)
pnpm db:seed

# 7. Map the catalog into discovered_product_pages
pnpm discover:run

# 8. Fetch + clean the first 3 pending products into the clean store
pnpm ingest:api oliveyoung-global 3

# 9. Run the API (http://localhost:3000) — observability console at /monitoring
pnpm dev:api
```

Verify: `GET http://localhost:3000/health` (liveness) and
`GET http://localhost:3000/health/ready` (database readiness).

## Watching the engine

- `GET /ingestion/sources` — configured sources and their seed URLs.
- `GET /ingestion/jobs?sourceId=&limit=` — recent ingest runs (status, timing).
- `GET /monitoring` — the observability console: per-table health (row counts,
  null-rates, duplicates), phase status, alerts, and a run timeline.

## Commands

| Command                      | What it does                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm build`                 | Build all packages/apps (topological order)                                                                 |
| `pnpm dev:api`               | Run the API with hot reload                                                                                 |
| `pnpm dev:worker`            | Run the idle worker skeleton (boot + validate + idle)                                                       |
| `pnpm discover:run`          | Map the source catalog into `discovered_product_pages`                                                      |
| `pnpm ingest:api [slug] [n]` | Fetch + clean `n` pending products straight into the clean store + snapshots (default: oliveyoung-global 3) |
| `pnpm db:seed`               | Idempotent seed of the approved ingestion source                                                            |
| `pnpm lint`                  | ESLint over the whole repo                                                                                  |
| `pnpm format`                | Prettier write                                                                                              |
| `pnpm test`                  | Vitest — DB-independent tests always run; integration tests run when `TEST_DATABASE_URL` is set             |
| `pnpm db:generate`           | Generate a SQL migration from Drizzle schema changes                                                        |
| `pnpm db:migrate`            | Apply pending migrations from `packages/db/migrations`                                                      |
| `pnpm db:studio`             | Browse the database with Drizzle Studio                                                                     |

Note: run `pnpm build` before `pnpm db:generate` — the DB schema imports
vocabulary constants from `@dip/domain`, which resolves from its built output.

## Migrations

Migrations are plain SQL files in `packages/db/migrations/`, generated by
drizzle-kit from the schema in `packages/db/src/schema/` and committed to the
repo. Never edit an applied migration; generate a new one.

## Deployment

See [deploy/DEPLOY.md](deploy/DEPLOY.md) for running DIP Engine on a
DigitalOcean droplet against a managed Postgres database (setup script, env
template, and a cron schedule for periodic re-fetches).

## Architecture rules (approved)

- **No raw layer, no object storage** — ingestion cleans in memory; the clean
  store + snapshots are the only durable engine outputs.
- **Re-runnable, not archived** — recovery is re-running `ingest:api` from the
  map, not restoring a raw copy.
- Clean store idempotent on `product_id`; snapshots on `(product_id, captured_at)`.
- text + CHECK constraints instead of native Postgres enums.
- Approved source: Olive Young Global — do NOT add other live sources without
  explicit approval.

See [CLAUDE.md](CLAUDE.md) for full project context.
