CREATE TABLE "retail_pulse_shelf_share" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"market_id" uuid,
	"retailer" text,
	"shelf_share_pct" numeric(6, 3),
	"facings" integer,
	"oos_pct" numeric(6, 3),
	"promo_pct" numeric(6, 3),
	"week_ending" date NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retail_pulse_shelf_share" ADD CONSTRAINT "retail_pulse_shelf_share_product_id_products_master_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products_master"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_pulse_shelf_share" ADD CONSTRAINT "retail_pulse_shelf_share_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rpss_product_market_week_unique" ON "retail_pulse_shelf_share" USING btree ("product_id","market_id","week_ending");