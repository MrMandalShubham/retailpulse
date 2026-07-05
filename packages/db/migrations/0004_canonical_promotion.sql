CREATE TABLE "product_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"media_type" text DEFAULT 'image' NOT NULL,
	"url" text NOT NULL,
	"storage_key" text,
	"position" integer DEFAULT 0 NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_media_media_type_check" CHECK ("media_type" IN ('image', 'video'))
);
--> statement-breakpoint
CREATE TABLE "product_search_documents" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"search_text" text NOT NULL,
	"search_vector" "tsvector",
	"brand_name" text,
	"category_name" text,
	"product_type_name" text,
	"price_value" numeric(12, 2),
	"price_currency" text,
	"rating" numeric(3, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"source_id" uuid,
	"source_slug" text,
	"staged_product_id" uuid,
	"source_url" text NOT NULL,
	"confidence_score" numeric(4, 3),
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_promoted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_sources_source_url_unique" UNIQUE("source_url")
);
--> statement-breakpoint
CREATE TABLE "promotion_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promotion_run_id" uuid NOT NULL,
	"staged_product_id" uuid,
	"source_id" uuid,
	"product_id" uuid,
	"decision" text NOT NULL,
	"eligibility_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"match_strategy" text,
	"match_score" numeric(4, 3),
	"confidence_score" numeric(4, 3),
	"operator_note" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_items_decision_check" CHECK ("decision" IN ('promoted_new', 'matched_existing', 'skipped_ineligible', 'skipped_ambiguous', 'rejected', 'failed')),
	CONSTRAINT "promotion_items_match_strategy_check" CHECK ("match_strategy" IN ('source_url', 'exact_brand_name', 'fuzzy_brand_name', 'new_product')),
	CONSTRAINT "promotion_items_match_score_check" CHECK ("promotion_items"."match_score" >= 0 AND "promotion_items"."match_score" <= 1)
);
--> statement-breakpoint
CREATE TABLE "promotion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trigger_type" text DEFAULT 'batch' NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"promoted_new" integer DEFAULT 0 NOT NULL,
	"matched_existing" integer DEFAULT 0 NOT NULL,
	"skipped_items" integer DEFAULT 0 NOT NULL,
	"failed_items" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_runs_status_check" CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed')),
	CONSTRAINT "promotion_runs_trigger_type_check" CHECK ("trigger_type" IN ('batch', 'single'))
);
--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_products_master_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products_master"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_search_documents" ADD CONSTRAINT "product_search_documents_product_id_products_master_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products_master"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sources" ADD CONSTRAINT "product_sources_product_id_products_master_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products_master"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sources" ADD CONSTRAINT "product_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sources" ADD CONSTRAINT "product_sources_staged_product_id_staged_products_id_fk" FOREIGN KEY ("staged_product_id") REFERENCES "public"."staged_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_items" ADD CONSTRAINT "promotion_items_promotion_run_id_promotion_runs_id_fk" FOREIGN KEY ("promotion_run_id") REFERENCES "public"."promotion_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_items" ADD CONSTRAINT "promotion_items_staged_product_id_staged_products_id_fk" FOREIGN KEY ("staged_product_id") REFERENCES "public"."staged_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_items" ADD CONSTRAINT "promotion_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_items" ADD CONSTRAINT "promotion_items_product_id_products_master_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products_master"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_media_product_id_url_unique" ON "product_media" USING btree ("product_id","url");--> statement-breakpoint
CREATE INDEX "product_search_documents_vector_idx" ON "product_search_documents" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "product_search_documents_brand_idx" ON "product_search_documents" USING btree ("brand_name");--> statement-breakpoint
CREATE INDEX "product_search_documents_price_idx" ON "product_search_documents" USING btree ("price_value");--> statement-breakpoint
CREATE INDEX "product_search_documents_rating_idx" ON "product_search_documents" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "product_sources_product_id_idx" ON "product_sources" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "promotion_items_run_id_idx" ON "promotion_items" USING btree ("promotion_run_id");--> statement-breakpoint
CREATE INDEX "promotion_items_decision_idx" ON "promotion_items" USING btree ("decision");--> statement-breakpoint
CREATE INDEX "promotion_items_product_id_idx" ON "promotion_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "promotion_items_staged_product_id_idx" ON "promotion_items" USING btree ("staged_product_id");--> statement-breakpoint
CREATE INDEX "promotion_runs_status_idx" ON "promotion_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "promotion_runs_created_at_idx" ON "promotion_runs" USING btree ("created_at");