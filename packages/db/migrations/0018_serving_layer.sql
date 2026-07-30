CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_kr" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path" text NOT NULL,
	"l1" text,
	"l2" text,
	"l3" text,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"region" text,
	"flag" text,
	"regulatory_authority" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" text NOT NULL,
	"product_name" text,
	"ingredients" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products_master" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text,
	"name" text,
	"sku" text,
	"barcode" text,
	"description" text,
	"domain" text,
	"category_id" uuid,
	"product_type_id" uuid,
	"brand_id" uuid,
	"price_segment" text,
	"texture_id" uuid,
	"skin_types" jsonb DEFAULT '[]'::jsonb,
	"skin_concerns" jsonb DEFAULT '[]'::jsonb,
	"spf_value" integer,
	"key_claims" jsonb DEFAULT '[]'::jsonb,
	"formulation_notes" text,
	"launch_date" date,
	"discontinuation_date" date,
	"price_benchmark_usd" numeric(12, 2),
	"market_status" text,
	"target_age_group" text,
	"primary_image_url" text,
	"data_quality_score" integer,
	"data_source" text,
	"verified" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"price_benchmark_eur" numeric(12, 2),
	"price_benchmark_krw" numeric(14, 2),
	"price_benchmark_jpy" numeric(14, 2),
	"is_best" boolean,
	"is_new" boolean,
	"source_url" text,
	"how_to_use" text,
	"ingredients_text" text,
	"sale_price" numeric(12, 2),
	"discount_rate" numeric(5, 2),
	"is_set" boolean,
	"parent_set_id" uuid
);
--> statement-breakpoint
CREATE TABLE "retail_products" (
	"product_id" text PRIMARY KEY NOT NULL,
	"name_en" text,
	"brand_name" text,
	"brand_name_kr" text,
	"category_l1" text,
	"category_l2" text,
	"category_l3" text,
	"regular_price" numeric(12, 2),
	"sale_price" numeric(12, 2),
	"discount_rate" numeric(5, 2),
	"currency" text,
	"min_coupon_price" numeric(12, 2),
	"stock_qty" integer,
	"sell_status_code" text,
	"is_best" boolean,
	"is_new" boolean,
	"primary_image" text,
	"review_count" integer,
	"avg_rating" numeric(3, 2),
	"media_review_count" integer,
	"product_name" text,
	"size_value" numeric(10, 2),
	"size_unit" text,
	"set_type" text,
	"composition" text,
	"source_url" text,
	"ingredients" text,
	"how_to_use" text,
	"selling_point" text,
	"why_we_love_it" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_pulse_sentiment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid,
	"market_id" uuid,
	"platform" text,
	"period_month" date NOT NULL,
	"sentiment_score" numeric(4, 3),
	"mention_count" integer,
	"positive_pct" numeric(5, 2),
	"negative_pct" numeric(5, 2),
	"neutral_pct" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"velocity_score" numeric(8, 2),
	"first_mention_date" date
);
--> statement-breakpoint
ALTER TABLE "products_master" ADD CONSTRAINT "products_master_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products_master" ADD CONSTRAINT "products_master_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_pulse_sentiment" ADD CONSTRAINT "voice_pulse_sentiment_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_pulse_sentiment" ADD CONSTRAINT "voice_pulse_sentiment_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brands_code_unique" ON "brands" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_path_unique" ON "categories" USING btree ("path");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_code_unique" ON "markets" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "product_ingredients_product_id_unique" ON "product_ingredients" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_master_source_url_unique" ON "products_master" USING btree ("source_url");--> statement-breakpoint
CREATE UNIQUE INDEX "vps_brand_market_platform_month_unique" ON "voice_pulse_sentiment" USING btree ("brand_id","market_id","platform","period_month");