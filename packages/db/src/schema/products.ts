import { MARKET_STATUSES, PRICE_SEGMENTS, PRODUCT_DOMAINS, PRODUCT_MARKET_STATUSES } from "@dip/domain";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { brands } from "./brands.js";
import { inList } from "./helpers.js";
import { markets } from "./markets.js";
import { categories, productTypes } from "./taxonomy.js";

/**
 * Canonical product hub: every clean product ends here.
 * Classification FKs are nullable on purpose — the ELT transform step may land a
 * product before brand/category resolution completes; data_quality_score tracks
 * completeness until the record is fully classified.
 */
export const productsMaster = pgTable(
  "products_master",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    sku: text("sku"),
    barcode: text("barcode"),
    description: text("description"),
    domain: text("domain"),
    categoryId: uuid("category_id").references(() => categories.id),
    productTypeId: uuid("product_type_id").references(() => productTypes.id),
    brandId: uuid("brand_id").references(() => brands.id),
    priceSegment: text("price_segment"),
    // Nullable, no FK: the textures master table is not part of the V1 core.
    textureId: uuid("texture_id"),
    skinTypes: text("skin_types").array(),
    skinConcerns: text("skin_concerns").array(),
    spfValue: integer("spf_value"),
    keyClaims: text("key_claims").array(),
    // Phase 7 enrichment columns (additive). Filled fill-if-null by @dip/enrichment,
    // never overwriting existing values; provenance lives in product_enrichments.
    paRating: text("pa_rating"),
    texture: text("texture"),
    ingredientHighlights: text("ingredient_highlights").array(),
    sizeValue: numeric("size_value", { precision: 10, scale: 2 }),
    sizeUnit: text("size_unit"),
    launchDate: date("launch_date"),
    discontinuationDate: date("discontinuation_date"),
    priceBenchmarkUsd: numeric("price_benchmark_usd", { precision: 12, scale: 2 }),
    marketStatus: text("market_status"),
    targetAgeGroup: text("target_age_group"),
    primaryImageUrl: text("primary_image_url"),
    dataQualityScore: numeric("data_quality_score", { precision: 5, scale: 2 }),
    dataSource: text("data_source"),
    verified: boolean("verified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("products_master_domain_check", inList("domain", PRODUCT_DOMAINS)),
    check("products_master_price_segment_check", inList("price_segment", PRICE_SEGMENTS)),
    check("products_master_market_status_check", inList("market_status", MARKET_STATUSES)),
    index("products_master_brand_id_idx").on(table.brandId),
    index("products_master_category_id_idx").on(table.categoryId),
    index("products_master_product_type_id_idx").on(table.productTypeId),
  ],
);

/**
 * Bridge table: product availability per market. One product, many markets —
 * products are never duplicated per country.
 */
export const productMarkets = pgTable(
  "product_markets",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => productsMaster.id),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    launchDate: date("launch_date"),
    status: text("status").notNull().default("Active"),
    localName: text("local_name"),
    localSku: text("local_sku"),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.marketId] }),
    check("product_markets_status_check", inList("status", PRODUCT_MARKET_STATUSES)),
    index("product_markets_market_id_idx").on(table.marketId),
  ],
);
