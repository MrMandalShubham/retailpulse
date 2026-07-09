CREATE TABLE "brand_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"value" text,
	"value_json" jsonb,
	"method" text NOT NULL,
	"confidence_score" numeric(4, 3),
	"source_url" text,
	"source_type" text DEFAULT 'brand_reference' NOT NULL,
	"evidence" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"reason" text,
	"enrichment_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_facts_method_check" CHECK ("method" IN ('regex', 'rule', 'ai_classified', 'ai_extracted', 'reference')),
	CONSTRAINT "brand_facts_status_check" CHECK ("status" IN ('proposed', 'applied', 'rejected', 'needs_source')),
	CONSTRAINT "brand_facts_source_type_check" CHECK ("source_type" IN ('product_page', 'brand_reference', 'derived')),
	CONSTRAINT "brand_facts_confidence_check" CHECK ("brand_facts"."confidence_score" >= 0 AND "brand_facts"."confidence_score" <= 1)
);
--> statement-breakpoint
CREATE TABLE "news_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"brand_id" uuid,
	"source_id" uuid,
	"source_slug" text,
	"market_id" uuid,
	"news_type" text DEFAULT 'article' NOT NULL,
	"category" text,
	"sentiment" text,
	"sentiment_score" numeric(4, 3),
	"title" text,
	"summary" text,
	"url" text NOT NULL,
	"published_at" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence_score" numeric(4, 3),
	"source_url" text NOT NULL,
	"evidence" text,
	"fact_run_id" uuid,
	CONSTRAINT "news_facts_news_type_check" CHECK ("news_type" IN ('article', 'press_release', 'campaign', 'launch', 'award', 'social_post', 'editorial', 'event', 'other')),
	CONSTRAINT "news_facts_category_check" CHECK ("category" IN ('product_launch', 'marketing', 'sustainability', 'controversy', 'partnership', 'retail_expansion', 'award', 'other')),
	CONSTRAINT "news_facts_sentiment_check" CHECK ("sentiment" IN ('positive', 'neutral', 'negative', 'mixed')),
	CONSTRAINT "news_facts_sentiment_score_check" CHECK ("news_facts"."sentiment_score" >= -1 AND "news_facts"."sentiment_score" <= 1),
	CONSTRAINT "news_facts_confidence_check" CHECK ("news_facts"."confidence_score" >= 0 AND "news_facts"."confidence_score" <= 1),
	CONSTRAINT "news_facts_subject_check" CHECK ("news_facts"."product_id" IS NOT NULL OR "news_facts"."brand_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "sales_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"source_id" uuid,
	"source_slug" text,
	"market_id" uuid,
	"channel" text DEFAULT 'unknown' NOT NULL,
	"fact_type" text DEFAULT 'observed' NOT NULL,
	"metric" text NOT NULL,
	"metric_value" numeric(18, 4) NOT NULL,
	"metric_currency" text,
	"metric_unit" text,
	"period_grain" text DEFAULT 'snapshot' NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date,
	"observed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence_score" numeric(4, 3),
	"source_url" text NOT NULL,
	"evidence" text,
	"fact_run_id" uuid,
	CONSTRAINT "sales_facts_channel_check" CHECK ("channel" IN ('online', 'offline', 'marketplace', 'dtc', 'wholesale', 'unknown')),
	CONSTRAINT "sales_facts_metric_check" CHECK ("metric" IN ('units_sold', 'revenue', 'rank', 'review_velocity', 'restock_count', 'popularity_index', 'sold_out')),
	CONSTRAINT "sales_facts_period_grain_check" CHECK ("period_grain" IN ('day', 'week', 'month', 'quarter', 'snapshot')),
	CONSTRAINT "sales_facts_fact_type_check" CHECK ("fact_type" IN ('observed', 'derived')),
	CONSTRAINT "sales_facts_value_check" CHECK ("sales_facts"."metric_value" >= 0),
	CONSTRAINT "sales_facts_confidence_check" CHECK ("sales_facts"."confidence_score" >= 0 AND "sales_facts"."confidence_score" <= 1)
);
--> statement-breakpoint
ALTER TABLE "brand_facts" ADD CONSTRAINT "brand_facts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_facts" ADD CONSTRAINT "brand_facts_enrichment_run_id_enrichment_runs_id_fk" FOREIGN KEY ("enrichment_run_id") REFERENCES "public"."enrichment_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_facts" ADD CONSTRAINT "news_facts_product_id_products_master_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products_master"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_facts" ADD CONSTRAINT "news_facts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_facts" ADD CONSTRAINT "news_facts_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_facts" ADD CONSTRAINT "news_facts_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_facts" ADD CONSTRAINT "news_facts_fact_run_id_fact_runs_id_fk" FOREIGN KEY ("fact_run_id") REFERENCES "public"."fact_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_facts" ADD CONSTRAINT "sales_facts_product_id_products_master_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products_master"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_facts" ADD CONSTRAINT "sales_facts_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_facts" ADD CONSTRAINT "sales_facts_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_facts" ADD CONSTRAINT "sales_facts_fact_run_id_fact_runs_id_fk" FOREIGN KEY ("fact_run_id") REFERENCES "public"."fact_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_facts_brand_field_unique" ON "brand_facts" USING btree ("brand_id","field_name");--> statement-breakpoint
CREATE INDEX "brand_facts_status_idx" ON "brand_facts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "brand_facts_field_idx" ON "brand_facts" USING btree ("field_name");--> statement-breakpoint
CREATE UNIQUE INDEX "news_facts_dedup_unique" ON "news_facts" USING btree ("url","product_id","observed_at");--> statement-breakpoint
CREATE INDEX "news_facts_product_published_idx" ON "news_facts" USING btree ("product_id","published_at");--> statement-breakpoint
CREATE INDEX "news_facts_brand_id_idx" ON "news_facts" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "news_facts_market_id_idx" ON "news_facts" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "news_facts_source_id_idx" ON "news_facts" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "news_facts_news_type_idx" ON "news_facts" USING btree ("news_type");--> statement-breakpoint
CREATE INDEX "news_facts_sentiment_idx" ON "news_facts" USING btree ("sentiment");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_facts_dedup_unique" ON "sales_facts" USING btree ("product_id","source_url","metric","channel","period_start");--> statement-breakpoint
CREATE INDEX "sales_facts_product_period_idx" ON "sales_facts" USING btree ("product_id","period_start");--> statement-breakpoint
CREATE INDEX "sales_facts_market_id_idx" ON "sales_facts" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "sales_facts_source_id_idx" ON "sales_facts" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "sales_facts_metric_idx" ON "sales_facts" USING btree ("metric");