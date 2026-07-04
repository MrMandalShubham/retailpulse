# DIP Engine — Project Context

This file keeps AI-assisted sessions aligned. Read it before making changes.

## What DIP Engine is

A production-grade data ingestion and normalization platform (ELT) for global
product intelligence, built for a large beauty/product company:

1. **Extract** — scrape product websites, marketplaces, and review platforms.
2. **Load** — land raw HTML/JSON/media pointers in DigitalOcean (Postgres + Spaces) first, always.
3. **Transform** — AI + deterministic rules extract and clean product fields, prices, and review metrics.
4. **Publish** — clean records go into the normalized V1 core, serving comparison UIs, dashboards, reports, and a private AI.

It is the ingestion + normalization brain, not a simple scraper.

## The V1 core: exactly 8 tables

Normalized **operational hub-and-spoke** schema (NOT a warehouse star schema).
Defined in `packages/db/src/schema/`, migrated from `packages/db/migrations/`.

- `products_master` — canonical product hub; every clean product ends here.
- `brands`, `categories` (hierarchical), `product_types`, `markets` — master data.
- `product_markets` — product↔market bridge (one product, many markets; never duplicate products per country).
- `retail_pulse_prices` — weekly price facts (product, market, retailer, week_ending). Append-only.
- `voice_pulse_reviews` — MONTHLY analytical review metrics only in V1 (period_month grain). Append-only.

## Approved architecture rules

- Raw layer and normalized core strictly separated from day one. Raw-layer
  tables (`sources`, `crawl_jobs`, `raw_documents`, ...) do NOT exist yet — Phase 2.
- text + CHECK constraints instead of native Postgres enums (V1 decision, lower
  migration friction). Vocabularies live in `@dip/domain` constants — single
  source of truth for both TS types and DB CHECKs.
- `products_master.texture_id` and `brands.parent_company_id` are nullable
  UUIDs WITHOUT FK constraints (their master tables are not in the V1 core).
- `retail_pulse_prices` has a NON-unique index on (product_id, market_id,
  retailer, week_ending); the uniqueness rule is deliberately deferred.
- `text[]` arrays for `skin_types`, `skin_concerns`, `key_claims`.
- Fact tables are append-only; only the transform layer writes them.
- Phase-gated builds: implement ONLY the current phase. Never create
  future-phase modules, tables, or integrations without explicit instruction.

## Codebase layout

- `apps/api` — Fastify 5 backend. Module boundaries under `src/modules/`
  (health is the only live one). Future: query/ingestion/admin endpoints.
- `apps/worker` — background worker skeleton (boot → validate → idle).
- `packages/config` — zod-validated env loader; the only place reading process.env.
- `packages/domain` — pure shared contracts, 9 boundaries: catalog, taxonomy,
  markets, pricing, reviews, ingestion, raw-storage, normalization,
  ai-enrichment. No runtime deps.
- `packages/db` — Drizzle ORM schema + drizzle-kit SQL migrations + pg client.
- `services/` — reserved for Python services (ingestion Phase 2, transform Phase 3).

Tooling: pnpm workspaces, TypeScript (strict, ESM/NodeNext), ESLint + Prettier,
Vitest, docker-compose (Postgres 16). Planning material in `Breakdown/`, `DB/`,
`Docs/` is gitignored and must not be depended on or restructured.

## Phase status

**Phase 1 (done):** repo structure, backend skeleton, health endpoints, config
loader, DB connection, Drizzle schema + initial migration for the 8 tables,
domain contracts, dev tooling, this file.

**Phase 2 (done):** raw ingestion foundation. Raw-layer tables `sources`,
`crawl_jobs`, `raw_documents` (public schema, text + CHECK, CASCADE within the
raw layer, `sources.market_id` SET NULL). `@dip/storage` S3-compatible adapter
(DO Spaces in production, MinIO locally via docker-compose — same env
contract). Worker one-shot pipeline (`pnpm ingest:run`): enabled sources →
crawl job → fetch ≤5 seed URLs (app-level cap `MAX_SEED_URLS_PER_JOB`, polite
1s delay, retry/backoff) → payloads to object storage → `raw_documents` rows
(checksum, response_bytes, http_status) → job status. Read-only monitoring:
`GET /ingestion/sources`, `/ingestion/jobs`, `/ingestion/jobs/:id/raw-documents`.
Approved source: Olive Young Global, seed = approved homepage only — do NOT
add live URLs without explicit approval.

**Phase 3 (done):** hybrid transform + normalization engine (pre-AI). Staging
tables `transform_runs`, `staged_products` (incl. `dominant_signal`),
`normalization_rules` (UNIQUE rule_type+source_scope+match_key, source_scope
NOT NULL default 'global'), `transform_observations`. Worker pipeline
(`pnpm transform:run`, `--reprocess` to regenerate): eligible raw HTML docs →
deterministic extraction (title/meta/OG/JSON-LD/DOM/URL hints + rule-driven
selector/regex) → local normalization (rules, fuzzy matching vs master data,
price/rating/currency parsing) → page-type classification with
dominant_signal → field-level confidences + unresolved_fields →
validation_status → observations for leftovers (ai_recommended flags future
AI candidates). Learning loop: promoteObservationToRule() turns findings into
normalization_rules rows (AI flow is Phase 4, learned_from_ai). Read-only
monitoring under /transforms/*. Three-layer rule: raw = immutable evidence,
staging = regenerable, canonical = only via future PromotionService — Phase 3
has ZERO canonical writes (only reads master data for fuzzy matching).
staged_product_offers deliberately deferred. Deps added: cheerio,
fastest-levenshtein (worker only).

**Phase 4 (done):** AI-assisted review + selective escalation. Tables
`ai_review_runs`, `ai_review_items` (incl. `review_reason`),
`ai_rule_suggestions` (partial-unique open-fingerprint dup guard on
observation_id+rule_type+source_scope+match_key). `@dip/ai` package:
provider-agnostic contracts live in `@dip/domain` ai-enrichment; ONE shared
system prompt + zod-validated strict-JSON decision contract
(resolved/partially_resolved/unresolved/rejected); adapters = Mistral (plain
fetch REST, NO vendor SDK, retry on 429/5xx) + deterministic mock. Provider
chosen ONLY via config (`AI_PROVIDER`, default mock — safe; client's choice is
mistral + `MISTRAL_API_KEY`). Worker `pnpm ai-review:run`: strict gating
(ai_recommended staged products in needs_review/pending on product/unknown
pages; open observations of types unknown_brand/unknown_category/
unknown_product_type/conflicting_price/missing_required_field — unseen_pattern
and weak_product_candidate excluded; not-already-reviewed; AI_REVIEW_MAX_ITEMS
cap). AI output is ADVISORY: suggestions land in ai_rule_suggestions;
normalization_rules changes ONLY via POST
/ai-reviews/rule-suggestions/:id/approve (learned_from_ai=true, observation →
promoted_to_rule; duplicates → 409) or :id/reject. Read endpoints under
/ai-reviews/*. Vendor wire formats must NEVER leak outside
packages/ai/src/providers/. Canonical core still has ZERO automated writes.

**Explicitly OUT of scope until instructed (Phase 5+):** automatic canonical
product promotion, embeddings/semantic retrieval, chat/end-user AI features,
autonomous taxonomy generation, human moderation UI, cross-source product
deduplication, Playwright/browser scraping, smart crawling (sitemaps,
robots.txt, pagination), Redis queues and schedulers, dashboards/frontends,
report generation, presigned URLs / bucket listing.

## Conventions

- Schema naming must match the approved definitions exactly (snake_case tables/columns).
- New closed vocabularies: add a `X as const` array + type in `@dip/domain`,
  use `inList()` from `packages/db/src/schema/helpers.ts` for the CHECK.
- Migrations: `pnpm build` (domain must be built), then `pnpm db:generate`
  with `--name`; never edit applied migrations.
- Internal packages resolve from `dist/` — run `pnpm build` after changing them.
