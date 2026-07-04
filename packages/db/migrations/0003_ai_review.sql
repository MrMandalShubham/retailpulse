CREATE TABLE "ai_review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_review_run_id" uuid NOT NULL,
	"staged_product_id" uuid,
	"observation_id" uuid,
	"item_type" text NOT NULL,
	"review_reason" text,
	"provider_name" text NOT NULL,
	"model_name" text NOT NULL,
	"input_payload" jsonb NOT NULL,
	"output_payload" jsonb,
	"parsed_decision" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"confidence_score" numeric(4, 3),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_review_items_item_type_check" CHECK ("item_type" IN ('staged_product', 'observation')),
	CONSTRAINT "ai_review_items_status_check" CHECK ("status" IN ('pending', 'succeeded', 'failed', 'rejected')),
	CONSTRAINT "ai_review_items_confidence_check" CHECK ("ai_review_items"."confidence_score" >= 0 AND "ai_review_items"."confidence_score" <= 1)
);
--> statement-breakpoint
CREATE TABLE "ai_review_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"transform_run_id" uuid,
	"provider_name" text NOT NULL,
	"model_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"processed_items" integer DEFAULT 0 NOT NULL,
	"succeeded_items" integer DEFAULT 0 NOT NULL,
	"failed_items" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_review_runs_status_check" CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "ai_rule_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_review_item_id" uuid NOT NULL,
	"observation_id" uuid,
	"rule_type" text NOT NULL,
	"source_scope" text DEFAULT 'global' NOT NULL,
	"match_key" text NOT NULL,
	"match_value" text,
	"normalized_key" text,
	"normalized_value" text,
	"confidence_score" numeric(4, 3),
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_rule_suggestions_rule_type_check" CHECK ("rule_type" IN ('brand_alias', 'category_keyword', 'product_type_keyword', 'currency_hint', 'selector_hint', 'regex_pattern', 'ignore_pattern')),
	CONSTRAINT "ai_rule_suggestions_status_check" CHECK ("status" IN ('open', 'approved', 'rejected', 'promoted')),
	CONSTRAINT "ai_rule_suggestions_confidence_check" CHECK ("ai_rule_suggestions"."confidence_score" >= 0 AND "ai_rule_suggestions"."confidence_score" <= 1)
);
--> statement-breakpoint
ALTER TABLE "ai_review_items" ADD CONSTRAINT "ai_review_items_ai_review_run_id_ai_review_runs_id_fk" FOREIGN KEY ("ai_review_run_id") REFERENCES "public"."ai_review_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_items" ADD CONSTRAINT "ai_review_items_staged_product_id_staged_products_id_fk" FOREIGN KEY ("staged_product_id") REFERENCES "public"."staged_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_items" ADD CONSTRAINT "ai_review_items_observation_id_transform_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."transform_observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_runs" ADD CONSTRAINT "ai_review_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_runs" ADD CONSTRAINT "ai_review_runs_transform_run_id_transform_runs_id_fk" FOREIGN KEY ("transform_run_id") REFERENCES "public"."transform_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_rule_suggestions" ADD CONSTRAINT "ai_rule_suggestions_ai_review_item_id_ai_review_items_id_fk" FOREIGN KEY ("ai_review_item_id") REFERENCES "public"."ai_review_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_rule_suggestions" ADD CONSTRAINT "ai_rule_suggestions_observation_id_transform_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."transform_observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_review_items_run_id_idx" ON "ai_review_items" USING btree ("ai_review_run_id");--> statement-breakpoint
CREATE INDEX "ai_review_items_status_idx" ON "ai_review_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_review_items_staged_product_id_idx" ON "ai_review_items" USING btree ("staged_product_id");--> statement-breakpoint
CREATE INDEX "ai_review_items_observation_id_idx" ON "ai_review_items" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "ai_review_runs_status_idx" ON "ai_review_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_review_runs_created_at_idx" ON "ai_review_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_rule_suggestions_open_fingerprint_unique" ON "ai_rule_suggestions" USING btree ("observation_id","rule_type","source_scope","match_key") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "ai_rule_suggestions_status_idx" ON "ai_rule_suggestions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_rule_suggestions_rule_type_idx" ON "ai_rule_suggestions" USING btree ("rule_type");