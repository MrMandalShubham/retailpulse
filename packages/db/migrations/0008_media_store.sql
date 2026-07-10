CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_provider" text DEFAULT 'external' NOT NULL,
	"bucket_name" text,
	"object_key" text,
	"canonical_url" text,
	"media_type" text DEFAULT 'image' NOT NULL,
	"mime_type" text,
	"file_ext" text,
	"file_size_bytes" bigint,
	"checksum" text,
	"width" integer,
	"height" integer,
	"duration_seconds" numeric(10, 3),
	"source_url" text,
	"source_type" text,
	"origin_market_id" uuid,
	"source_id" uuid,
	"source_slug" text,
	"alt_text" text,
	"caption" text,
	"asset_status" text DEFAULT 'referenced' NOT NULL,
	"quality_score" numeric(4, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_storage_provider_check" CHECK ("storage_provider" IN ('do_spaces', 'minio', 's3', 'gcs', 'external')),
	CONSTRAINT "media_assets_media_type_check" CHECK ("media_type" IN ('image', 'video', 'audio', 'document', 'other')),
	CONSTRAINT "media_assets_source_type_check" CHECK ("source_type" IN ('product_page', 'brand_reference', 'marketplace', 'cdn', 'campaign', 'other')),
	CONSTRAINT "media_assets_asset_status_check" CHECK ("asset_status" IN ('pending', 'referenced', 'stored', 'approved', 'rejected', 'archived')),
	CONSTRAINT "media_assets_quality_score_check" CHECK ("media_assets"."quality_score" >= 0 AND "media_assets"."quality_score" <= 1),
	CONSTRAINT "media_assets_file_size_check" CHECK ("media_assets"."file_size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "media_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"variant_type" text NOT NULL,
	"bucket_name" text,
	"object_key" text,
	"canonical_url" text,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"file_size_bytes" bigint,
	"duration_seconds" numeric(10, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_variants_variant_type_check" CHECK ("variant_type" IN ('thumbnail', 'small', 'medium', 'large', 'webp', 'avif', 'preview', 'poster', 'transcode_720p', 'transcode_1080p', 'compressed')),
	CONSTRAINT "media_variants_file_size_check" CHECK ("media_variants"."file_size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_media_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"media_role" text DEFAULT 'gallery' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"market_id" uuid,
	"source_id" uuid,
	"source_slug" text,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_media_links_media_role_check" CHECK ("media_role" IN ('primary', 'gallery', 'detail', 'ingredient', 'before_after', 'video_demo', 'ad_creative', 'packaging', 'texture', 'campaign', 'swatch', 'other')),
	CONSTRAINT "product_media_links_sort_order_check" CHECK ("product_media_links"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_origin_market_id_markets_id_fk" FOREIGN KEY ("origin_market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media_links" ADD CONSTRAINT "product_media_links_product_id_products_master_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products_master"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media_links" ADD CONSTRAINT "product_media_links_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media_links" ADD CONSTRAINT "product_media_links_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media_links" ADD CONSTRAINT "product_media_links_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_checksum_unique" ON "media_assets" USING btree ("checksum") WHERE "media_assets"."checksum" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_source_url_unique" ON "media_assets" USING btree ("source_url") WHERE "media_assets"."source_url" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "media_assets_source_id_idx" ON "media_assets" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "media_assets_origin_market_id_idx" ON "media_assets" USING btree ("origin_market_id");--> statement-breakpoint
CREATE INDEX "media_assets_media_type_idx" ON "media_assets" USING btree ("media_type");--> statement-breakpoint
CREATE INDEX "media_assets_asset_status_idx" ON "media_assets" USING btree ("asset_status");--> statement-breakpoint
CREATE UNIQUE INDEX "media_variants_media_variant_type_unique" ON "media_variants" USING btree ("media_id","variant_type");--> statement-breakpoint
CREATE INDEX "media_variants_media_id_idx" ON "media_variants" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_media_links_product_media_role_unique" ON "product_media_links" USING btree ("product_id","media_id","media_role");--> statement-breakpoint
CREATE UNIQUE INDEX "product_media_links_one_primary_per_product" ON "product_media_links" USING btree ("product_id") WHERE "product_media_links"."is_primary";--> statement-breakpoint
CREATE INDEX "product_media_links_product_id_idx" ON "product_media_links" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_media_links_media_id_idx" ON "product_media_links" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "product_media_links_market_id_idx" ON "product_media_links" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "product_media_links_source_id_idx" ON "product_media_links" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "product_media_links_media_role_idx" ON "product_media_links" USING btree ("media_role");