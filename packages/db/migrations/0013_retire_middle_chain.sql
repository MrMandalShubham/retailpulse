ALTER TABLE "ai_review_items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_review_runs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_rule_suggestions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brand_facts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brands" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "enrichment_runs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fact_runs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "markets" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_assets" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_variants" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "news_facts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "normalization_rules" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_enrichments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_markets" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_media" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_media_links" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_price_facts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_rating_facts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_search_documents" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_sources" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_types" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products_master" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "promotion_items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "promotion_runs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "retail_pulse_prices" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_facts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "source_markets" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staged_products" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transform_observations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transform_runs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "voice_pulse_reviews" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ai_review_items" CASCADE;--> statement-breakpoint
DROP TABLE "ai_review_runs" CASCADE;--> statement-breakpoint
DROP TABLE "ai_rule_suggestions" CASCADE;--> statement-breakpoint
DROP TABLE "brand_facts" CASCADE;--> statement-breakpoint
DROP TABLE "brands" CASCADE;--> statement-breakpoint
DROP TABLE "categories" CASCADE;--> statement-breakpoint
DROP TABLE "enrichment_runs" CASCADE;--> statement-breakpoint
DROP TABLE "fact_runs" CASCADE;--> statement-breakpoint
DROP TABLE "markets" CASCADE;--> statement-breakpoint
DROP TABLE "media_assets" CASCADE;--> statement-breakpoint
DROP TABLE "media_variants" CASCADE;--> statement-breakpoint
DROP TABLE "news_facts" CASCADE;--> statement-breakpoint
DROP TABLE "normalization_rules" CASCADE;--> statement-breakpoint
DROP TABLE "product_enrichments" CASCADE;--> statement-breakpoint
DROP TABLE "product_markets" CASCADE;--> statement-breakpoint
DROP TABLE "product_media" CASCADE;--> statement-breakpoint
DROP TABLE "product_media_links" CASCADE;--> statement-breakpoint
DROP TABLE "product_price_facts" CASCADE;--> statement-breakpoint
DROP TABLE "product_rating_facts" CASCADE;--> statement-breakpoint
DROP TABLE "product_search_documents" CASCADE;--> statement-breakpoint
DROP TABLE "product_sources" CASCADE;--> statement-breakpoint
DROP TABLE "product_types" CASCADE;--> statement-breakpoint
DROP TABLE "products_master" CASCADE;--> statement-breakpoint
DROP TABLE "promotion_items" CASCADE;--> statement-breakpoint
DROP TABLE "promotion_runs" CASCADE;--> statement-breakpoint
DROP TABLE "retail_pulse_prices" CASCADE;--> statement-breakpoint
DROP TABLE "sales_facts" CASCADE;--> statement-breakpoint
DROP TABLE "source_markets" CASCADE;--> statement-breakpoint
DROP TABLE "staged_products" CASCADE;--> statement-breakpoint
DROP TABLE "transform_observations" CASCADE;--> statement-breakpoint
DROP TABLE "transform_runs" CASCADE;--> statement-breakpoint
DROP TABLE "voice_pulse_reviews" CASCADE;--> statement-breakpoint
ALTER TABLE "sources" DROP CONSTRAINT IF EXISTS "sources_market_id_markets_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "sources_market_id_idx";--> statement-breakpoint
ALTER TABLE "sources" DROP COLUMN IF EXISTS "market_id";