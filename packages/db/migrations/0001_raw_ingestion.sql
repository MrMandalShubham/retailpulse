CREATE TABLE "crawl_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crawl_jobs_status_check" CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "raw_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_job_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"url" text NOT NULL,
	"content_type" text,
	"storage_key" text,
	"checksum" text,
	"status" text NOT NULL,
	"http_status" integer,
	"response_bytes" integer,
	"error_message" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raw_documents_status_check" CHECK ("status" IN ('ok', 'error', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"base_url" text NOT NULL,
	"source_type" text DEFAULT 'website' NOT NULL,
	"market_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"seed_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"scrape_strategy" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_slug_unique" UNIQUE("slug"),
	CONSTRAINT "sources_source_type_check" CHECK ("source_type" IN ('website', 'marketplace', 'api', 'review_platform'))
);
--> statement-breakpoint
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_documents" ADD CONSTRAINT "raw_documents_crawl_job_id_crawl_jobs_id_fk" FOREIGN KEY ("crawl_job_id") REFERENCES "public"."crawl_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_documents" ADD CONSTRAINT "raw_documents_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_jobs_source_id_idx" ON "crawl_jobs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "crawl_jobs_status_idx" ON "crawl_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "crawl_jobs_created_at_idx" ON "crawl_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "raw_documents_crawl_job_id_idx" ON "raw_documents" USING btree ("crawl_job_id");--> statement-breakpoint
CREATE INDEX "raw_documents_source_id_fetched_at_idx" ON "raw_documents" USING btree ("source_id","fetched_at");--> statement-breakpoint
CREATE INDEX "raw_documents_url_idx" ON "raw_documents" USING btree ("url");--> statement-breakpoint
CREATE INDEX "sources_market_id_idx" ON "sources" USING btree ("market_id");