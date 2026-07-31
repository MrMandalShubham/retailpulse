CREATE TABLE "brand_market_share" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_name" text,
	"brand_slug" text,
	"is_tracked" boolean DEFAULT false,
	"market" text,
	"market_code" text,
	"category" text,
	"period_type" text,
	"period_label" text,
	"period_start" date,
	"period_end" date,
	"units_sold" bigint,
	"revenue" numeric(20, 2),
	"currency" text,
	"total_category_units" bigint,
	"total_category_revenue" numeric(20, 2),
	"market_share_pct" numeric(6, 3),
	"units_share_pct" numeric(6, 3),
	"rank_in_category" integer,
	"rank_change" integer,
	"change_pct" numeric(8, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bms_brand_category_period_market_unique" ON "brand_market_share" USING btree ("brand_slug","category","period_label","market_code");