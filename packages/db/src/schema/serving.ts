import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Dashboard SERVING layer — derived, read-facing tables the Retail dashboard
 * reads. Everything here is a PROJECTION of `oliveyoung_global_products`
 * (+ snapshots), rebuilt idempotently by the `distribute` step (`pnpm
 * distribute`). Nothing here is a source of truth — it can always be dropped
 * and re-derived from the clean store.
 *
 * Shapes match the dashboard's expected columns. `brands` / `categories` are
 * minimal dimensions we own (the dashboard references them by id); if the
 * dashboard's own versions carry extra columns, align them here.
 */

/* ------------------------------- dimensions ------------------------------ */

/** Brand dimension — distinct brands from the clean store. Keyed by brand_no. */
export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(), // brand_no
    name: text("name").notNull(), // brand_name
    nameKr: text("name_kr"), // brand_name_kr
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("brands_code_unique").on(t.code)],
);

/** Category dimension — distinct category paths from the clean store. */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    path: text("path").notNull(), // "L1 > L2 > L3"
    l1: text("l1"),
    l2: text("l2"),
    l3: text("l3"),
    name: text("name"), // leaf (l3 ?? l2 ?? l1)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("categories_path_unique").on(t.path)],
);

/** Market dimension — reference list of markets. Our data attaches to "XG". */
export const markets = pgTable(
  "markets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    region: text("region"),
    flag: text("flag"),
    regulatoryAuthority: text("regulatory_authority"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("markets_code_unique").on(t.code)],
);

/* --------------------------------- facts --------------------------------- */

/**
 * Leaderboard table — a flat 1:1 mirror of the clean store (denormalized,
 * brand/category as text). Keyed by product_id.
 */
export const retailProducts = pgTable("retail_products", {
  productId: text("product_id").primaryKey(),
  nameEn: text("name_en"),
  brandName: text("brand_name"),
  brandNameKr: text("brand_name_kr"),
  categoryL1: text("category_l1"),
  categoryL2: text("category_l2"),
  categoryL3: text("category_l3"),
  regularPrice: numeric("regular_price", { precision: 12, scale: 2 }),
  salePrice: numeric("sale_price", { precision: 12, scale: 2 }),
  discountRate: numeric("discount_rate", { precision: 5, scale: 2 }),
  currency: text("currency"),
  minCouponPrice: numeric("min_coupon_price", { precision: 12, scale: 2 }),
  stockQty: integer("stock_qty"),
  sellStatusCode: text("sell_status_code"),
  isBest: boolean("is_best"),
  isNew: boolean("is_new"),
  primaryImage: text("primary_image"),
  reviewCount: integer("review_count"),
  avgRating: numeric("avg_rating", { precision: 3, scale: 2 }),
  mediaReviewCount: integer("media_review_count"),
  productName: text("product_name"),
  sizeValue: numeric("size_value", { precision: 10, scale: 2 }),
  sizeUnit: text("size_unit"),
  setType: text("set_type"),
  composition: text("composition"),
  sourceUrl: text("source_url"),
  ingredients: text("ingredients"),
  howToUse: text("how_to_use"),
  sellingPoint: text("selling_point"),
  whyWeLoveIt: text("why_we_love_it"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Canonical product hub (normalized). Links to brands/categories by id.
 * Enrichment columns (skin_types, spf, texture, price_segment, multi-currency
 * benchmarks, …) are gaps for the Olive Young source — left null/default.
 * Idempotency key: source_url (1:1 with a source listing).
 */
export const productsMaster = pgTable(
  "products_master",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug"),
    name: text("name"),
    sku: text("sku"),
    barcode: text("barcode"),
    description: text("description"),
    domain: text("domain"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    productTypeId: uuid("product_type_id"),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    priceSegment: text("price_segment"),
    textureId: uuid("texture_id"),
    skinTypes: jsonb("skin_types").default(sql`'[]'::jsonb`),
    skinConcerns: jsonb("skin_concerns").default(sql`'[]'::jsonb`),
    spfValue: integer("spf_value"),
    keyClaims: jsonb("key_claims").default(sql`'[]'::jsonb`),
    formulationNotes: text("formulation_notes"),
    launchDate: date("launch_date"),
    discontinuationDate: date("discontinuation_date"),
    priceBenchmarkUsd: numeric("price_benchmark_usd", { precision: 12, scale: 2 }),
    marketStatus: text("market_status"),
    targetAgeGroup: text("target_age_group"),
    primaryImageUrl: text("primary_image_url"),
    dataQualityScore: integer("data_quality_score"),
    dataSource: text("data_source"),
    verified: boolean("verified").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    priceBenchmarkEur: numeric("price_benchmark_eur", { precision: 12, scale: 2 }),
    priceBenchmarkKrw: numeric("price_benchmark_krw", { precision: 14, scale: 2 }),
    priceBenchmarkJpy: numeric("price_benchmark_jpy", { precision: 14, scale: 2 }),
    isBest: boolean("is_best"),
    isNew: boolean("is_new"),
    sourceUrl: text("source_url"),
    howToUse: text("how_to_use"),
    ingredientsText: text("ingredients_text"),
    salePrice: numeric("sale_price", { precision: 12, scale: 2 }),
    discountRate: numeric("discount_rate", { precision: 5, scale: 2 }),
    isSet: boolean("is_set"),
    parentSetId: uuid("parent_set_id"),
  },
  (t) => [uniqueIndex("products_master_source_url_unique").on(t.sourceUrl)],
);

/**
 * Product ↔ hero-ingredients (denormalized as an array, per decision — the
 * source only yields dictionary hero actives, not a full INCI list).
 */
export const productIngredients = pgTable(
  "product_ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: text("product_id").notNull(),
    productName: text("product_name"),
    ingredients: text("ingredients").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("product_ingredients_product_id_unique").on(t.productId)],
);

/**
 * Brand sentiment per market per month (rating-derived proxy — NOT text NLP).
 * Aggregated from the clean store's rating/review/star-breakdown, attached to
 * the Global (XG) market. velocity_score/first_mention_date accumulate as
 * snapshot history grows.
 */
export const voicePulseSentiment = pgTable(
  "voice_pulse_sentiment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    marketId: uuid("market_id").references(() => markets.id, { onDelete: "set null" }),
    platform: text("platform"),
    periodMonth: date("period_month").notNull(),
    sentimentScore: numeric("sentiment_score", { precision: 4, scale: 3 }),
    mentionCount: integer("mention_count"),
    positivePct: numeric("positive_pct", { precision: 5, scale: 2 }),
    negativePct: numeric("negative_pct", { precision: 5, scale: 2 }),
    neutralPct: numeric("neutral_pct", { precision: 5, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    velocityScore: numeric("velocity_score", { precision: 8, scale: 2 }),
    firstMentionDate: date("first_mention_date"),
  },
  (t) => [
    uniqueIndex("vps_brand_market_platform_month_unique").on(
      t.brandId,
      t.marketId,
      t.platform,
      t.periodMonth,
    ),
  ],
);

/**
 * Category/subcategory share per product per period. The source has NO sales,
 * so `units_sold` and the *_units_* columns hold a REVIEW-VOLUME proxy (a
 * product's review_count as its demand weight) — popularity, not units. The
 * revenue side (`revenue`, `*_revenue`, `subcategory_share_pct`,
 * `category_share_pct`) stays null; it needs a real sales/POS source.
 * `product_id` is our idempotency anchor (not read by the dashboard).
 */
export const productCategoryShare = pgTable(
  "product_category_share",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: text("product_id").notNull(), // our key (not a dashboard column)
    productName: text("product_name"),
    productSlug: text("product_slug"),
    brandName: text("brand_name"),
    brandSlug: text("brand_slug"),
    isTracked: boolean("is_tracked").default(false),
    market: text("market"),
    marketCode: text("market_code"),
    category: text("category"),
    subcategory: text("subcategory"),
    periodType: text("period_type"),
    periodLabel: text("period_label"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    // --- units family = review-volume proxy ---
    unitsSold: bigint("units_sold", { mode: "number" }),
    totalSubcategoryUnits: bigint("total_subcategory_units", { mode: "number" }),
    totalCategoryUnits: bigint("total_category_units", { mode: "number" }),
    unitsSubcategorySharePct: numeric("units_subcategory_share_pct", { precision: 6, scale: 3 }),
    unitsCategorySharePct: numeric("units_category_share_pct", { precision: 6, scale: 3 }),
    // --- revenue family = gap (no sales) ---
    revenue: numeric("revenue", { precision: 20, scale: 2 }),
    totalSubcategoryRevenue: numeric("total_subcategory_revenue", { precision: 20, scale: 2 }),
    totalCategoryRevenue: numeric("total_category_revenue", { precision: 20, scale: 2 }),
    subcategorySharePct: numeric("subcategory_share_pct", { precision: 6, scale: 3 }),
    categorySharePct: numeric("category_share_pct", { precision: 6, scale: 3 }),
    // --- rank ---
    rankInSubcategory: integer("rank_in_subcategory"),
    rankChange: integer("rank_change"),
    changePct: numeric("change_pct", { precision: 8, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pcs_product_period_market_unique").on(t.productId, t.periodLabel, t.marketCode),
  ],
);

/**
 * Per-product monthly sales history. The source has NO sales, so `units_sold`
 * holds a REVIEW-VOLUME proxy (review_count as the demand weight) and `revenue`
 * stays null. One row per product per month (Global/XG, USD). `product_id` is
 * our idempotency anchor (not a dashboard column). True month-over-month units
 * (review deltas) become possible once snapshot history spans months.
 */
export const productSalesHistory = pgTable(
  "product_sales_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: text("product_id").notNull(), // our key (not a dashboard column)
    productSlug: text("product_slug"),
    sku: text("sku"),
    retailer: text("retailer"),
    market: text("market"),
    currency: text("currency"),
    periodType: text("period_type"),
    periodLabel: text("period_label"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    unitsSold: bigint("units_sold", { mode: "number" }), // review-volume proxy
    revenue: numeric("revenue", { precision: 20, scale: 2 }), // gap (no sales)
    lastUpdated: timestamp("last_updated", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("psh_product_period_unique").on(t.productId, t.periodLabel)],
);

/**
 * Brand share within a category per market per quarter. Review-volume proxy:
 * `units_sold` = the brand's summed review_count in that category; `units_share_pct`
 * = brand review-volume ÷ category review-volume. The revenue side (`revenue`,
 * `total_category_revenue`, `market_share_pct`) stays null — no sales in the source.
 */
export const brandMarketShare = pgTable(
  "brand_market_share",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandName: text("brand_name"),
    brandSlug: text("brand_slug"),
    isTracked: boolean("is_tracked").default(false),
    market: text("market"),
    marketCode: text("market_code"),
    category: text("category"),
    periodType: text("period_type"),
    periodLabel: text("period_label"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    unitsSold: bigint("units_sold", { mode: "number" }), // review-volume proxy
    revenue: numeric("revenue", { precision: 20, scale: 2 }), // gap (no sales)
    currency: text("currency"),
    totalCategoryUnits: bigint("total_category_units", { mode: "number" }),
    totalCategoryRevenue: numeric("total_category_revenue", { precision: 20, scale: 2 }), // gap
    marketSharePct: numeric("market_share_pct", { precision: 6, scale: 3 }), // revenue share → gap
    unitsSharePct: numeric("units_share_pct", { precision: 6, scale: 3 }), // review-volume proxy
    rankInCategory: integer("rank_in_category"),
    rankChange: integer("rank_change"),
    changePct: numeric("change_pct", { precision: 8, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bms_brand_category_period_market_unique").on(
      t.brandSlug,
      t.category,
      t.periodLabel,
      t.marketCode,
    ),
  ],
);
