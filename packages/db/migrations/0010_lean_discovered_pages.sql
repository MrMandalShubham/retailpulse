DROP TABLE "discovered_product_pages" CASCADE;--> statement-breakpoint
CREATE TABLE "discovered_product_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"product_name" text,
	"product_url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"batch_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dpp_batch_status_check" CHECK ("batch_status" IN ('pending', 'queued', 'ingested', 'promoted', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "discovered_product_pages" ADD CONSTRAINT "discovered_product_pages_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dpp_source_product_unique" ON "discovered_product_pages" USING btree ("source_id","product_id");--> statement-breakpoint
CREATE INDEX "dpp_source_batch_idx" ON "discovered_product_pages" USING btree ("source_id","batch_status");--> statement-breakpoint
CREATE INDEX "dpp_normalized_url_idx" ON "discovered_product_pages" USING btree ("normalized_url");
