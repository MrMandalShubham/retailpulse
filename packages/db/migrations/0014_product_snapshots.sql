CREATE TABLE "oliveyoung_global_product_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" text NOT NULL,
	"captured_at" date NOT NULL,
	"regular_price" numeric(12, 2),
	"sale_price" numeric(12, 2),
	"discount_rate" numeric(5, 2),
	"avg_rating" numeric(3, 2),
	"review_count" integer,
	"stock_qty" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "oyg_snapshots_product_date_unique" ON "oliveyoung_global_product_snapshots" USING btree ("product_id","captured_at");--> statement-breakpoint
CREATE INDEX "oyg_snapshots_captured_at_idx" ON "oliveyoung_global_product_snapshots" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "oyg_snapshots_product_id_idx" ON "oliveyoung_global_product_snapshots" USING btree ("product_id");