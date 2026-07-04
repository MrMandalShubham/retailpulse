# DIP Engine

Production-grade data ingestion and normalization platform for global product
intelligence. DIP Engine scrapes product-related websites, lands raw data in a
raw layer (ELT), transforms it with AI + deterministic rules, and publishes
clean records into a normalized 8-table core that powers product comparison,
dashboards, reports, and a private AI.

**Current status: Phase 4 — AI-assisted review and selective escalation.**
A provider-agnostic AI layer reviews ONLY the unresolved leftovers from the
Phase 3 transform (gated: `ai_recommended` staged products and open
field-level observations). Business logic talks to internal review contracts;
vendors are adapters (`@dip/ai`: Mistral via plain REST + a deterministic
mock, default `AI_PROVIDER=mock` so nothing calls a paid API accidentally).
AI decisions are structured, validated, and advisory — rule candidates land in
`ai_rule_suggestions` and become `normalization_rules` (learned_from_ai) only
through the operator approval endpoint. Canonical tables remain untouched.

Previous phase summary (Phase 3 — hybrid transform + normalization engine):
On top of the Phase 2 raw layer, a local (no-AI) transform pipeline extracts
product candidates from raw HTML (title/meta/OpenGraph/JSON-LD/DOM heuristics),
normalizes them with reusable `normalization_rules` (brand aliases, currency
hints, keyword mappings, fuzzy matching), classifies page types, scores
field-level confidence, and records unresolved leftovers as
`transform_observations` for **future** AI escalation. Repeated discoveries
become rules, so every run needs less AI. No LLM calls, no browser scraping,
no writes into the canonical 8-table core (promotion is a Phase 4 contract).

## Repository layout

```
apps/
  api/          Fastify backend (health + raw-ingestion monitoring; query APIs later)
  worker/       Ingestion worker: one-shot raw fetch pipeline + idle skeleton
packages/
  config/       @dip/config — zod-validated environment loader (single env source of truth)
  domain/       @dip/domain — shared domain contracts (pure types, no runtime deps)
  db/           @dip/db — Drizzle schema, pg client, SQL migrations, seed script
  storage/      @dip/storage — S3-compatible raw object storage (Spaces/MinIO)
  ai/           @dip/ai — provider-agnostic AI review (prompt contract, Mistral + mock adapters)
services/       Reserved for Python services (advanced scraping, AI transform — Phase 3+)
```

The normalized V1 core is exactly 8 tables: `products_master` (canonical hub),
`brands`, `categories`, `product_types`, `markets`, `product_markets` (bridge),
`retail_pulse_prices` and `voice_pulse_reviews` (append-only facts).

The raw ELT layer (Phase 2) adds `sources`, `crawl_jobs`, and `raw_documents` —
a strictly separate data flow: nothing in the normalized core references the
raw layer, and the Phase 2 pipeline never writes to the core.

The staging/transform layer (Phase 3) adds `transform_runs`, `staged_products`,
`normalization_rules`, and `transform_observations`. Three-layer rule:
**raw = immutable evidence · staging = regenerable working data · canonical =
curated truth** (written only via explicit promotion, Phase 4). Staged rows can
be deleted and regenerated from raw at any time (`--reprocess`).

## Prerequisites

- Node.js >= 22
- pnpm >= 9
- Docker Desktop (for local Postgres)

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Create your local environment file
cp .env.example .env        # PowerShell: Copy-Item .env.example .env

# 3. Start local Postgres + MinIO (S3-compatible stand-in for DO Spaces)
docker compose up -d

# 4. Build workspace packages (internal packages resolve from dist/)
pnpm build

# 5. Apply database migrations
pnpm db:migrate

# 6. Seed the approved ingestion source (Olive Young Global)
pnpm db:seed

# 7. Create the raw-storage bucket in MinIO (once)
pnpm bucket:ensure

# 8. Run one raw ingestion cycle (fetch seed URLs -> MinIO + raw_documents)
pnpm ingest:run

# 9. Run one hybrid transform cycle (raw docs -> staged_products + observations)
pnpm transform:run

# 10. Run one AI review cycle over unresolved leftovers (mock provider by default)
pnpm ai-review:run

# 11. Run the API (http://localhost:3000)
pnpm dev:api
```

Verify: `GET http://localhost:3000/health` (liveness) and
`GET http://localhost:3000/health/ready` (database readiness).

### Watching raw ingestion

- `GET /ingestion/sources` — configured sources and their seed URLs.
- `GET /ingestion/jobs?sourceId=&limit=` — recent crawl jobs with status,
  timing, and `rawDocumentCount` per job.
- `GET /ingestion/jobs/:id/raw-documents` — every fetched URL of a job with
  HTTP status, storage key, checksum, and size.

The MinIO console at http://localhost:9001 (user `dip-minio`, password
`dip-minio-secret`) shows the stored raw payloads under `dip-engine-raw/raw/…`.

### Watching the transform layer

- `GET /transforms/runs` and `/transforms/runs/:id` — run history with
  document counters plus staged/observation counts.
- `GET /transforms/staged-products?validationStatus=&sourceId=&aiRecommended=` —
  extracted product candidates with confidence and validation state.
- `GET /transforms/staged-products/:id` — full candidate detail including
  field candidates, field confidences, and linked observations.
- `GET /transforms/observations?status=&type=` — unresolved leftovers queued
  for future AI review (`unknown_brand`, `conflicting_price`, …).
- `GET /transforms/rules` — active normalization rules (the system's learned
  intelligence; rows added here change behavior on the next run, no code).

### Watching the AI review layer

- `GET /ai-reviews/runs` and `/ai-reviews/runs/:id` — review batches with
  per-status item counts.
- `GET /ai-reviews/items?status=&provider=` — every item escalated to AI, with
  `review_reason`, full input payload, raw output, and the parsed decision.
- `GET /ai-reviews/rule-suggestions?status=` — AI-proposed rules awaiting the
  approval path.
- `POST /ai-reviews/rule-suggestions/:id/approve` — the ONLY way an AI
  suggestion becomes a `normalization_rules` row (`learned_from_ai = true`);
  also moves the linked observation to `promoted_to_rule`.
- `POST /ai-reviews/rule-suggestions/:id/reject` — dismiss a bad suggestion.

Provider selection is config-only: `AI_PROVIDER=mock` (default, free) or
`AI_PROVIDER=mistral` + `MISTRAL_API_KEY`. Swapping vendors later means one
new adapter file in `packages/ai/src/providers/` — no business-logic changes.

## Commands

| Command              | What it does                                                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`         | Build all packages/apps (topological order)                                                                                                                                                                      |
| `pnpm dev:api`       | Run the API with hot reload                                                                                                                                                                                      |
| `pnpm dev:worker`    | Run the idle worker skeleton (boot + validate + idle)                                                                                                                                                            |
| `pnpm ingest:run`    | One-shot raw ingestion cycle (Phase 2 manual trigger): reads enabled sources, fetches up to 5 seed URLs each, stores payloads in object storage, records crawl_jobs + raw_documents                              |
| `pnpm transform:run` | One-shot hybrid transform cycle (Phase 3, no AI): eligible raw docs → deterministic extraction → rule-based normalization → staged_products + transform_observations. Add `-- --reprocess` to regenerate staging |
| `pnpm ai-review:run` | One-shot AI review cycle (Phase 4): gated unresolved leftovers → configured provider (`AI_PROVIDER`) → ai_review_items + ai_rule_suggestions. Advisory only; rules change only via the approval endpoint         |
| `pnpm db:seed`       | Idempotent seed of the approved ingestion source                                                                                                                                                                 |
| `pnpm bucket:ensure` | Create the raw-storage bucket (local MinIO helper)                                                                                                                                                               |
| `pnpm lint`          | ESLint over the whole repo                                                                                                                                                                                       |
| `pnpm format`        | Prettier write                                                                                                                                                                                                   |
| `pnpm test`          | Vitest — DB-independent tests always run; integration tests against a migrated DB run when `TEST_DATABASE_URL` is set                                                                                            |
| `pnpm db:generate`   | Generate SQL migration from Drizzle schema changes                                                                                                                                                               |
| `pnpm db:migrate`    | Apply pending migrations from `packages/db/migrations`                                                                                                                                                           |
| `pnpm db:studio`     | Browse the database with Drizzle Studio                                                                                                                                                                          |

Note: run `pnpm build` before `pnpm db:generate` — the DB schema imports
vocabulary constants from `@dip/domain`, which resolves from its built output.

## Migrations

Migrations are plain SQL files in `packages/db/migrations/`, generated by
drizzle-kit from the schema in `packages/db/src/schema/` and committed to the
repo. Plain SQL keeps the schema history readable and usable by the future
Python services. Never edit an applied migration; generate a new one.

## Architecture rules (approved)

- ELT: raw data always lands first; transforms produce the clean records.
- Raw layer and the normalized 8-table core stay strictly separated
  (raw-layer tables arrive in Phase 2).
- `products_master` is the canonical hub; markets connect via `product_markets`
  (never duplicate products per country).
- `retail_pulse_prices` and `voice_pulse_reviews` are append-only in V1.
- text + CHECK constraints instead of native Postgres enums in V1.
- Phase-gated delivery: only the current phase is implemented.

See [CLAUDE.md](CLAUDE.md) for the full project context and phase scope.
