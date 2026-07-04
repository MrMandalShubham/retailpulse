CREATE TABLE "normalization_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_type" text NOT NULL,
	"source_scope" text DEFAULT 'global' NOT NULL,
	"match_key" text NOT NULL,
	"match_value" text,
	"normalized_key" text,
	"normalized_value" text,
	"priority" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"learned_from_ai" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "normalization_rules_rule_type_check" CHECK ("rule_type" IN ('brand_alias', 'category_keyword', 'product_type_keyword', 'currency_hint', 'selector_hint', 'regex_pattern', 'ignore_pattern'))
);
--> statement-breakpoint
CREATE TABLE "staged_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transform_run_id" uuid NOT NULL,
	"raw_document_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_url" text,
	"page_type" text,
	"dominant_signal" text,
	"extracted_name" text,
	"extracted_brand" text,
	"extracted_category" text,
	"extracted_product_type" text,
	"extracted_description" text,
	"extracted_currency" text,
	"extracted_price_text" text,
	"extracted_rating_text" text,
	"primary_image_url" text,
	"extraction_method" text,
	"confidence_score" numeric(4, 3),
	"validation_status" text DEFAULT 'pending' NOT NULL,
	"validation_errors" text[] DEFAULT '{}'::text[] NOT NULL,
	"normalized_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"field_candidates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"field_confidences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"unresolved_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"ai_recommended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staged_products_page_type_check" CHECK ("page_type" IN ('product', 'listing', 'non_product', 'unknown')),
	CONSTRAINT "staged_products_extraction_method_check" CHECK ("extraction_method" IN ('jsonld', 'opengraph', 'meta_tags', 'dom_heuristic', 'url_hint', 'rule_inferred', 'mixed')),
	CONSTRAINT "staged_products_validation_status_check" CHECK ("validation_status" IN ('pending', 'valid', 'invalid', 'needs_review')),
	CONSTRAINT "staged_products_confidence_score_check" CHECK ("staged_products"."confidence_score" >= 0 AND "staged_products"."confidence_score" <= 1)
);
--> statement-breakpoint
CREATE TABLE "transform_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transform_run_id" uuid NOT NULL,
	"staged_product_id" uuid,
	"raw_document_id" uuid NOT NULL,
	"observation_type" text NOT NULL,
	"field_name" text,
	"raw_value" text,
	"suggested_value" text,
	"confidence_score" numeric(4, 3),
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transform_observations_type_check" CHECK ("observation_type" IN ('unknown_brand', 'unknown_category', 'unknown_product_type', 'conflicting_price', 'weak_product_candidate', 'unseen_pattern', 'missing_required_field')),
	CONSTRAINT "transform_observations_status_check" CHECK ("status" IN ('open', 'ignored', 'resolved', 'promoted_to_rule')),
	CONSTRAINT "transform_observations_confidence_check" CHECK ("transform_observations"."confidence_score" >= 0 AND "transform_observations"."confidence_score" <= 1)
);
--> statement-breakpoint
CREATE TABLE "transform_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_job_id" uuid,
	"source_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"total_documents" integer DEFAULT 0 NOT NULL,
	"processed_documents" integer DEFAULT 0 NOT NULL,
	"succeeded_documents" integer DEFAULT 0 NOT NULL,
	"failed_documents" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transform_runs_status_check" CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "staged_products" ADD CONSTRAINT "staged_products_transform_run_id_transform_runs_id_fk" FOREIGN KEY ("transform_run_id") REFERENCES "public"."transform_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staged_products" ADD CONSTRAINT "staged_products_raw_document_id_raw_documents_id_fk" FOREIGN KEY ("raw_document_id") REFERENCES "public"."raw_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staged_products" ADD CONSTRAINT "staged_products_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transform_observations" ADD CONSTRAINT "transform_observations_transform_run_id_transform_runs_id_fk" FOREIGN KEY ("transform_run_id") REFERENCES "public"."transform_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transform_observations" ADD CONSTRAINT "transform_observations_staged_product_id_staged_products_id_fk" FOREIGN KEY ("staged_product_id") REFERENCES "public"."staged_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transform_observations" ADD CONSTRAINT "transform_observations_raw_document_id_raw_documents_id_fk" FOREIGN KEY ("raw_document_id") REFERENCES "public"."raw_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transform_runs" ADD CONSTRAINT "transform_runs_crawl_job_id_crawl_jobs_id_fk" FOREIGN KEY ("crawl_job_id") REFERENCES "public"."crawl_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transform_runs" ADD CONSTRAINT "transform_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "normalization_rules_type_scope_key_unique" ON "normalization_rules" USING btree ("rule_type","source_scope","match_key");--> statement-breakpoint
CREATE INDEX "normalization_rules_rule_type_active_idx" ON "normalization_rules" USING btree ("rule_type","active");--> statement-breakpoint
CREATE INDEX "staged_products_transform_run_id_idx" ON "staged_products" USING btree ("transform_run_id");--> statement-breakpoint
CREATE INDEX "staged_products_raw_document_id_idx" ON "staged_products" USING btree ("raw_document_id");--> statement-breakpoint
CREATE INDEX "staged_products_source_id_idx" ON "staged_products" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "staged_products_validation_status_idx" ON "staged_products" USING btree ("validation_status");--> statement-breakpoint
CREATE INDEX "staged_products_ai_recommended_idx" ON "staged_products" USING btree ("ai_recommended");--> statement-breakpoint
CREATE INDEX "transform_observations_status_idx" ON "transform_observations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "transform_observations_type_idx" ON "transform_observations" USING btree ("observation_type");--> statement-breakpoint
CREATE INDEX "transform_observations_run_id_idx" ON "transform_observations" USING btree ("transform_run_id");--> statement-breakpoint
CREATE INDEX "transform_observations_raw_document_id_idx" ON "transform_observations" USING btree ("raw_document_id");--> statement-breakpoint
CREATE INDEX "transform_runs_status_idx" ON "transform_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "transform_runs_created_at_idx" ON "transform_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "transform_runs_source_id_idx" ON "transform_runs" USING btree ("source_id");