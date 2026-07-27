-- Drop the raw layer. Ingestion now fetches each product's API envelope in
-- memory and writes the clean per-platform store directly, so raw_documents +
-- object storage are gone. The FK from oliveyoung_global_products is removed by
-- the CASCADE, so its explicit drop uses IF EXISTS to stay idempotent.
DROP TABLE IF EXISTS "raw_documents" CASCADE;--> statement-breakpoint
ALTER TABLE "oliveyoung_global_products" DROP CONSTRAINT IF EXISTS "oliveyoung_global_products_raw_document_id_raw_documents_id_fk";--> statement-breakpoint
ALTER TABLE "oliveyoung_global_products" DROP COLUMN IF EXISTS "raw_document_id";
