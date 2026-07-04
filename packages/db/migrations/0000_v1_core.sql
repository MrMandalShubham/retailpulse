CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"parent_company_id" uuid,
	"brand_tier" text,
	"country_of_origin" text,
	"market_id" uuid,
	"founding_year" integer,
	"sustainability_rating" text,
	"description" text,
	"logo_url" text,
	"website" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_slug_unique" UNIQUE("slug"),
	CONSTRAINT "brands_brand_tier_check" CHECK ("brand_tier" IN ('Luxury', 'Premium', 'Mass', 'Indie', 'Professional'))
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"product_domain" text,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "categories_product_domain_check" CHECK ("product_domain" IN ('Cosmetics', 'Aesthetics', 'Nutri_Cosmetics', 'Oral_Care'))
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" char(2) NOT NULL,
	"region" text,
	"flag" text,
	"regulatory_authority" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_name_unique" UNIQUE("name"),
	CONSTRAINT "markets_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "product_markets" (
	"product_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"launch_date" date,
	"status" text DEFAULT 'Active' NOT NULL,
	"local_name" text,
	"local_sku" text,
	CONSTRAINT "product_markets_product_id_market_id_pk" PRIMARY KEY("product_id","market_id"),
	CONSTRAINT "product_markets_status_check" CHECK ("status" IN ('Active', 'Discontinued', 'Coming_Soon'))
);
--> statement-breakpoint
CREATE TABLE "product_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "products_master" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"barcode" text,
	"description" text,
	"domain" text,
	"category_id" uuid,
	"product_type_id" uuid,
	"brand_id" uuid,
	"price_segment" text,
	"texture_id" uuid,
	"skin_types" text[],
	"skin_concerns" text[],
	"spf_value" integer,
	"key_claims" text[],
	"launch_date" date,
	"discontinuation_date" date,
	"price_benchmark_usd" numeric(12, 2),
	"market_status" text,
	"target_age_group" text,
	"primary_image_url" text,
	"data_quality_score" numeric(5, 2),
	"data_source" text,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_master_slug_unique" UNIQUE("slug"),
	CONSTRAINT "products_master_domain_check" CHECK ("domain" IN ('Cosmetics', 'Aesthetics', 'Nutri_Cosmetics', 'Oral_Care')),
	CONSTRAINT "products_master_price_segment_check" CHECK ("price_segment" IN ('Luxury', 'Premium', 'Mass_Market', 'Drugstore', 'Professional')),
	CONSTRAINT "products_master_market_status_check" CHECK ("market_status" IN ('Active', 'Discontinued', 'Coming_Soon'))
);
--> statement-breakpoint
CREATE TABLE "retail_pulse_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"retailer" text NOT NULL,
	"regular_price" numeric(12, 2),
	"promo_price" numeric(12, 2),
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"week_ending" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_pulse_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"period_month" date NOT NULL,
	"avg_rating" numeric(3, 2),
	"review_count" integer,
	"recommendation_pct" numeric(5, 2),
	"repurchase_pct" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_pulse_reviews_avg_rating_check" CHECK ("voice_pulse_reviews"."avg_rating" >= 0 AND "voice_pulse_reviews"."avg_rating" <= 5),
	CONSTRAINT "voice_pulse_reviews_review_count_check" CHECK ("voice_pulse_reviews"."review_count" >= 0),
	CONSTRAINT "voice_pulse_reviews_recommendation_pct_check" CHECK ("voice_pulse_reviews"."recommendation_pct" >= 0 AND "voice_pulse_reviews"."recommendation_pct" <= 100),
	CONSTRAINT "voice_pulse_reviews_repurchase_pct_check" CHECK ("voice_pulse_reviews"."repurchase_pct" >= 0 AND "voice_pulse_reviews"."repurchase_pct" <= 100)
);
--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_markets" ADD CONSTRAINT "product_markets_product_id_products_master_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products_master"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_markets" ADD CONSTRAINT "product_markets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_types" ADD CONSTRAINT "product_types_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products_master" ADD CONSTRAINT "products_master_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products_master" ADD CONSTRAINT "products_master_product_type_id_product_types_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products_master" ADD CONSTRAINT "products_master_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_pulse_prices" ADD CONSTRAINT "retail_pulse_prices_product_id_products_master_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products_master"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_pulse_prices" ADD CONSTRAINT "retail_pulse_prices_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_pulse_reviews" ADD CONSTRAINT "voice_pulse_reviews_product_id_products_master_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products_master"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_pulse_reviews" ADD CONSTRAINT "voice_pulse_reviews_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brands_market_id_idx" ON "brands" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "categories_parent_id_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "product_markets_market_id_idx" ON "product_markets" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "product_types_category_id_idx" ON "product_types" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_master_brand_id_idx" ON "products_master" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "products_master_category_id_idx" ON "products_master" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_master_product_type_id_idx" ON "products_master" USING btree ("product_type_id");--> statement-breakpoint
CREATE INDEX "retail_pulse_prices_series_idx" ON "retail_pulse_prices" USING btree ("product_id","market_id","retailer","week_ending");--> statement-breakpoint
CREATE INDEX "retail_pulse_prices_market_id_idx" ON "retail_pulse_prices" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "retail_pulse_prices_week_ending_idx" ON "retail_pulse_prices" USING btree ("week_ending");--> statement-breakpoint
CREATE INDEX "voice_pulse_reviews_series_idx" ON "voice_pulse_reviews" USING btree ("product_id","market_id","platform","period_month");--> statement-breakpoint
CREATE INDEX "voice_pulse_reviews_market_id_idx" ON "voice_pulse_reviews" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "voice_pulse_reviews_period_month_idx" ON "voice_pulse_reviews" USING btree ("period_month");