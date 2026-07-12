CREATE TABLE "discovered_product_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"source_slug" text,
	"discovered_product_name" text,
	"product_url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"url_hash" text NOT NULL,
	"discovery_method" text NOT NULL,
	"page_type_confidence" numeric(4, 3),
	"crawl_depth" integer DEFAULT 0 NOT NULL,
	"parent_listing_url" text,
	"candidate_market_id" uuid,
	"discovery_status" text DEFAULT 'candidate' NOT NULL,
	"batch_status" text DEFAULT 'pending' NOT NULL,
	"canonical_product_id" uuid,
	"discovery_run_id" uuid,
	"error_reason" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dpp_method_check" CHECK ("discovery_method" IN ('sitemap', 'category_crawl', 'pagination', 'js_render', 'manual', 'ai_verified')),
	CONSTRAINT "dpp_discovery_status_check" CHECK ("discovery_status" IN ('candidate', 'confirmed', 'rejected', 'stale')),
	CONSTRAINT "dpp_batch_status_check" CHECK ("batch_status" IN ('pending', 'queued', 'ingested', 'promoted', 'failed', 'skipped')),
	CONSTRAINT "dpp_confidence_check" CHECK ("discovered_product_pages"."page_type_confidence" >= 0 AND "discovered_product_pages"."page_type_confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"strategy" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"urls_discovered" integer DEFAULT 0 NOT NULL,
	"new_urls" integer DEFAULT 0 NOT NULL,
	"updated_urls" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_runs_status_check" CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed')),
	CONSTRAINT "discovery_runs_strategy_check" CHECK ("strategy" IN ('sitemap', 'category_crawl', 'pagination', 'js_render', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "discovery_config" jsonb;--> statement-breakpoint
ALTER TABLE "discovered_product_pages" ADD CONSTRAINT "discovered_product_pages_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovered_product_pages" ADD CONSTRAINT "discovered_product_pages_candidate_market_id_markets_id_fk" FOREIGN KEY ("candidate_market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovered_product_pages" ADD CONSTRAINT "discovered_product_pages_canonical_product_id_products_master_id_fk" FOREIGN KEY ("canonical_product_id") REFERENCES "public"."products_master"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovered_product_pages" ADD CONSTRAINT "discovered_product_pages_discovery_run_id_discovery_runs_id_fk" FOREIGN KEY ("discovery_run_id") REFERENCES "public"."discovery_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dpp_source_url_hash_unique" ON "discovered_product_pages" USING btree ("source_id","url_hash");--> statement-breakpoint
CREATE INDEX "dpp_source_batch_idx" ON "discovered_product_pages" USING btree ("source_id","batch_status");--> statement-breakpoint
CREATE INDEX "dpp_discovery_status_idx" ON "discovered_product_pages" USING btree ("discovery_status");--> statement-breakpoint
CREATE INDEX "dpp_normalized_url_idx" ON "discovered_product_pages" USING btree ("normalized_url");--> statement-breakpoint
CREATE INDEX "dpp_canonical_product_id_idx" ON "discovered_product_pages" USING btree ("canonical_product_id");--> statement-breakpoint
CREATE INDEX "discovery_runs_source_id_idx" ON "discovery_runs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "discovery_runs_created_at_idx" ON "discovery_runs" USING btree ("created_at");