# services/

Reserved for the Python services of DIP Engine (empty by design in Phase 1):

- `ingestion-py` — scraper workers (HTTP + Playwright) writing raw payloads to
  object storage and raw metadata tables. **Phase 2.**
- `transform-py` — AI extraction, normalization, and validation services that
  turn raw documents into clean records for the 8 normalized V1 tables. **Phase 3.**

These services will share the database (via the SQL migrations in
`packages/db/migrations/`) and mirror the contracts defined in
`packages/domain/` (ingestion, raw-storage, normalization).
