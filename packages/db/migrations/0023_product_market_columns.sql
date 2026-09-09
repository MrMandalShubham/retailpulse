ALTER TABLE "products_master" ADD COLUMN "market" text;--> statement-breakpoint
ALTER TABLE "products_master" ADD COLUMN "market_code" text;--> statement-breakpoint
ALTER TABLE "retail_products" ADD COLUMN "market" text;--> statement-breakpoint
ALTER TABLE "retail_products" ADD COLUMN "market_code" text;