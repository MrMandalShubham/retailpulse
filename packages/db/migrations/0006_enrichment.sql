CREATE TABLE "enrichment_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"products_considered" integer DEFAULT 0 NOT NULL,
	"deterministic_applied" integer DEFAULT 0 NOT NULL,
	"ai_proposed" integer DEFAULT 0 NOT NULL,
	"needs_source" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrichment_runs_status_check" CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "product_enrichments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"value" text,
	"value_json" jsonb,
	"method" text NOT NULL,
	"confidence_score" numeric(4, 3),
	"source_url" text,
	"source_type" text DEFAULT 'derived' NOT NULL,
	"evidence" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"reason" text,
	"enrichment_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_enrichments_method_check" CHECK ("method" IN ('regex', 'rule', 'ai_classified', 'ai_extracted', 'reference')),
	CONSTRAINT "product_enrichments_status_check" CHECK ("status" IN ('proposed', 'applied', 'rejected', 'needs_source')),
	CONSTRAINT "product_enrichments_source_type_check" CHECK ("source_type" IN ('product_page', 'brand_reference', 'derived')),
	CONSTRAINT "product_enrichments_confidence_check" CHECK ("product_enrichments"."confidence_score" >= 0 AND "product_enrichments"."confidence_score" <= 1)
);
--> statement-breakpoint
ALTER TABLE "products_master" ADD COLUMN "pa_rating" text;--> statement-breakpoint
ALTER TABLE "products_master" ADD COLUMN "texture" text;--> statement-breakpoint
ALTER TABLE "products_master" ADD COLUMN "ingredient_highlights" text[];--> statement-breakpoint
ALTER TABLE "products_master" ADD COLUMN "size_value" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "products_master" ADD COLUMN "size_unit" text;--> statement-breakpoint
ALTER TABLE "product_enrichments" ADD CONSTRAINT "product_enrichments_product_id_products_master_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products_master"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_enrichments" ADD CONSTRAINT "product_enrichments_enrichment_run_id_enrichment_runs_id_fk" FOREIGN KEY ("enrichment_run_id") REFERENCES "public"."enrichment_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrichment_runs_created_at_idx" ON "enrichment_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_enrichments_product_field_unique" ON "product_enrichments" USING btree ("product_id","field_name");--> statement-breakpoint
CREATE INDEX "product_enrichments_status_idx" ON "product_enrichments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_enrichments_field_idx" ON "product_enrichments" USING btree ("field_name");