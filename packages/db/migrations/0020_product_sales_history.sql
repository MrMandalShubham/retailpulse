CREATE TABLE "product_sales_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" text NOT NULL,
	"product_slug" text,
	"sku" text,
	"retailer" text,
	"market" text,
	"currency" text,
	"period_type" text,
	"period_label" text,
	"period_start" date,
	"period_end" date,
	"units_sold" bigint,
	"revenue" numeric(20, 2),
	"last_updated" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "psh_product_period_unique" ON "product_sales_history" USING btree ("product_id","period_label");