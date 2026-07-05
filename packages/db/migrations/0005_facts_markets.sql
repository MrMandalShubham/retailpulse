CREATE TABLE "fact_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"products_considered" integer DEFAULT 0 NOT NULL,
	"price_facts_inserted" integer DEFAULT 0 NOT NULL,
	"rating_facts_inserted" integer DEFAULT 0 NOT NULL,
	"duplicates_skipped" integer DEFAULT 0 NOT NULL,
	"skipped_invalid" integer DEFAULT 0 NOT NULL,
	"core_rollups_inserted" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fact_runs_status_check" CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "product_price_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"source_id" uuid,
	"source_slug" text,
	"staged_product_id" uuid,
	"market_id" uuid,
	"fact_type" text DEFAULT 'observed',
	"price_value" numeric(12, 2) NOT NULL,
	"price_currency" text NOT NULL,
	"price_original_text" text,
	"observed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence_score" numeric(4, 3),
	"source_url" text NOT NULL,
	"fact_run_id" uuid,
	CONSTRAINT "product_price_facts_fact_type_check" CHECK ("fact_type" IN ('observed', 'derived')),
	CONSTRAINT "product_price_facts_price_check" CHECK ("product_price_facts"."price_value" > 0),
	CONSTRAINT "product_price_facts_confidence_check" CHECK ("product_price_facts"."confidence_score" >= 0 AND "product_price_facts"."confidence_score" <= 1)
);
--> statement-breakpoint
CREATE TABLE "product_rating_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"source_id" uuid,
	"source_slug" text,
	"staged_product_id" uuid,
	"market_id" uuid,
	"fact_type" text DEFAULT 'observed',
	"rating_value" numeric(3, 2) NOT NULL,
	"rating_scale" text DEFAULT '0-5' NOT NULL,
	"review_count" integer,
	"rating_original_text" text,
	"observed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence_score" numeric(4, 3),
	"source_url" text NOT NULL,
	"fact_run_id" uuid,
	CONSTRAINT "product_rating_facts_fact_type_check" CHECK ("fact_type" IN ('observed', 'derived')),
	CONSTRAINT "product_rating_facts_rating_check" CHECK ("product_rating_facts"."rating_value" >= 0 AND "product_rating_facts"."rating_value" <= 5),
	CONSTRAINT "product_rating_facts_review_count_check" CHECK ("product_rating_facts"."review_count" >= 0),
	CONSTRAINT "product_rating_facts_confidence_check" CHECK ("product_rating_facts"."confidence_score" >= 0 AND "product_rating_facts"."confidence_score" <= 1)
);
--> statement-breakpoint
CREATE TABLE "source_markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"confidence" text DEFAULT 'inferred' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_markets_confidence_check" CHECK ("confidence" IN ('confirmed', 'inferred'))
);
--> statement-breakpoint
ALTER TABLE "product_price_facts" ADD CONSTRAINT "product_price_facts_product_id_products_master_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products_master"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_facts" ADD CONSTRAINT "product_price_facts_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_facts" ADD CONSTRAINT "product_price_facts_staged_product_id_staged_products_id_fk" FOREIGN KEY ("staged_product_id") REFERENCES "public"."staged_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_facts" ADD CONSTRAINT "product_price_facts_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_facts" ADD CONSTRAINT "product_price_facts_fact_run_id_fact_runs_id_fk" FOREIGN KEY ("fact_run_id") REFERENCES "public"."fact_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_rating_facts" ADD CONSTRAINT "product_rating_facts_product_id_products_master_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products_master"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_rating_facts" ADD CONSTRAINT "product_rating_facts_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_rating_facts" ADD CONSTRAINT "product_rating_facts_staged_product_id_staged_products_id_fk" FOREIGN KEY ("staged_product_id") REFERENCES "public"."staged_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_rating_facts" ADD CONSTRAINT "product_rating_facts_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_rating_facts" ADD CONSTRAINT "product_rating_facts_fact_run_id_fact_runs_id_fk" FOREIGN KEY ("fact_run_id") REFERENCES "public"."fact_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_markets" ADD CONSTRAINT "source_markets_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_markets" ADD CONSTRAINT "source_markets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fact_runs_created_at_idx" ON "fact_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_price_facts_dedup_unique" ON "product_price_facts" USING btree ("product_id","source_url","observed_at");--> statement-breakpoint
CREATE INDEX "product_price_facts_product_observed_idx" ON "product_price_facts" USING btree ("product_id","observed_at");--> statement-breakpoint
CREATE INDEX "product_price_facts_source_id_idx" ON "product_price_facts" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "product_price_facts_market_id_idx" ON "product_price_facts" USING btree ("market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_rating_facts_dedup_unique" ON "product_rating_facts" USING btree ("product_id","source_url","observed_at");--> statement-breakpoint
CREATE INDEX "product_rating_facts_product_observed_idx" ON "product_rating_facts" USING btree ("product_id","observed_at");--> statement-breakpoint
CREATE INDEX "product_rating_facts_source_id_idx" ON "product_rating_facts" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "product_rating_facts_market_id_idx" ON "product_rating_facts" USING btree ("market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_markets_source_market_unique" ON "source_markets" USING btree ("source_id","market_id");--> statement-breakpoint
CREATE INDEX "source_markets_market_id_idx" ON "source_markets" USING btree ("market_id");