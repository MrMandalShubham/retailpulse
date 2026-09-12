CREATE TABLE "cosme_jp_product_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" text NOT NULL,
	"captured_at" date NOT NULL,
	"rating" numeric(3, 2),
	"rating_raw" numeric(4, 2),
	"review_count" integer,
	"rank_in_category" integer,
	"price" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cosme_jp_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" text NOT NULL,
	"source_url" text NOT NULL,
	"fetched_at" timestamp with time zone,
	"name_ja" text,
	"name_en" text,
	"product_name" text,
	"brand_no" text,
	"brand_name_ja" text,
	"brand_name_en" text,
	"category_ja" text,
	"category_en" text,
	"rank_in_category" integer,
	"rating_raw" numeric(4, 2),
	"rating" numeric(3, 2),
	"pt_score" numeric(8, 1),
	"review_count" integer,
	"have_count" integer,
	"want_count" integer,
	"price" numeric(12, 2),
	"currency" text DEFAULT 'JPY' NOT NULL,
	"size_value" numeric(10, 2),
	"size_unit" text,
	"price_variants" jsonb,
	"primary_image" text,
	"description_ja" text,
	"description_en" text,
	"key_ingredients" text[],
	"release_date" date,
	"source_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cosme_products_rating_check" CHECK ("cosme_jp_products"."rating" >= 0 AND "cosme_jp_products"."rating" <= 5),
	CONSTRAINT "cosme_products_review_count_check" CHECK ("cosme_jp_products"."review_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cosme_snapshots_product_date_unique" ON "cosme_jp_product_snapshots" USING btree ("product_id","captured_at");--> statement-breakpoint
CREATE INDEX "cosme_snapshots_captured_at_idx" ON "cosme_jp_product_snapshots" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "cosme_snapshots_product_id_idx" ON "cosme_jp_product_snapshots" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cosme_products_product_id_unique" ON "cosme_jp_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "cosme_products_brand_no_idx" ON "cosme_jp_products" USING btree ("brand_no");--> statement-breakpoint
CREATE INDEX "cosme_products_rating_idx" ON "cosme_jp_products" USING btree ("rating");