import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { rawDocuments } from "./ingestion.js";

/**
 * Olive Young Global — clean per-platform product store.
 *
 * This is the platform's FINAL clean store: one fully-transformed, typed row
 * per product. Populated from the Phase 1 raw envelopes by a dedicated clean
 * step (HTML entities decoded, prices as numbers, Y/N -> boolean, YYYYMMDD ->
 * date, category path split, text trimmed). The verbatim raw stays in the
 * bucket + raw_documents; nothing raw or half-parsed lands here.
 *
 * Per-platform by design: every source's API exposes different fields, so each
 * platform gets its own clean table (sephora_us_products, etc.). Structured
 * nested data (options, images, review breakdown) is kept as cleaned JSONB.
 */
export const oliveyoungGlobalProducts = pgTable(
  "oliveyoung_global_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // --- identity & lineage ---
    productId: text("product_id").notNull(), // prdtNo
    barcode: text("barcode"), // gdsCd (GTIN)
    sourceUrl: text("source_url").notNull(),
    // Keep the clean row even if raw evidence is pruned later.
    rawDocumentId: uuid("raw_document_id").references(() => rawDocuments.id, {
      onDelete: "set null",
    }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),

    // --- name & brand ---
    nameEn: text("name_en"), // raw source name (kept verbatim)
    nameKr: text("name_kr"),
    // Parsed from name_en (heuristic; name_en stays the fallback):
    productName: text("product_name"), // brand + core name (size/set/gift stripped)
    sizeValue: numeric("size_value", { precision: 10, scale: 2 }),
    sizeUnit: text("size_unit"), // ml / g / ea …
    setType: text("set_type"), // Set / Double Set / Duo / Pack … (null if not a set)
    composition: text("composition"), // gift/bonus text, e.g. "+3ml" (null if none)
    brandNo: text("brand_no"),
    brandName: text("brand_name"),
    brandNameKr: text("brand_name_kr"),

    // --- category (platform taxonomy, cleaned) ---
    categoryNo: text("category_no"),
    categoryPathEn: text("category_path_en"),
    categoryPathKr: text("category_path_kr"),
    categoryL1: text("category_l1"),
    categoryL2: text("category_l2"),
    categoryL3: text("category_l3"),

    // --- pricing ---
    regularPrice: numeric("regular_price", { precision: 12, scale: 2 }),
    salePrice: numeric("sale_price", { precision: 12, scale: 2 }),
    discountRate: numeric("discount_rate", { precision: 5, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    minCouponPrice: numeric("min_coupon_price", { precision: 12, scale: 2 }),

    // --- availability & flags ---
    stockQty: integer("stock_qty"),
    sellStatusCode: text("sell_status_code"),
    isBest: boolean("is_best"),
    isNew: boolean("is_new"),
    isFlash: boolean("is_flash"),
    isSellingFast: boolean("is_selling_fast"),
    releaseDate: date("release_date"),

    // --- content (cleaned text) ---
    descriptionHtml: text("description_html"),
    sellingPoint: text("selling_point"),
    whyWeLoveIt: text("why_we_love_it"),
    ingredients: text("ingredients"), // raw marketing prose (fallback)
    keyIngredients: text("key_ingredients").array(), // hero actives parsed from the prose
    howToUse: text("how_to_use"),

    // --- media & reviews (scalars) ---
    primaryImage: text("primary_image"),
    reviewCount: integer("review_count"),
    avgRating: numeric("avg_rating", { precision: 3, scale: 2 }),
    mediaReviewCount: integer("media_review_count"),

    // --- structured nested data (cleaned JSONB) ---
    options: jsonb("options"),
    thumbnails: jsonb("thumbnails"),
    promotion: jsonb("promotion"),
    memberPricing: jsonb("member_pricing"),
    starBreakdown: jsonb("star_breakdown"),
    attributeScores: jsonb("attribute_scores"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One clean row per source product (idempotency anchor for the clean step).
    uniqueIndex("oyg_products_product_id_unique").on(table.productId),
    index("oyg_products_brand_no_idx").on(table.brandNo),
    index("oyg_products_barcode_idx").on(table.barcode),
    index("oyg_products_avg_rating_idx").on(table.avgRating),
    check("oyg_products_rating_check", sql`${table.avgRating} >= 0 AND ${table.avgRating} <= 5`),
    check("oyg_products_review_count_check", sql`${table.reviewCount} >= 0`),
  ],
);

/**
 * Time-series snapshots — one row per product per capture date. Appended by the
 * clean-load (`platform:load`) using the raw envelope's fetch date, so history
 * accumulates as products are re-ingested over time. This is what powers the
 * dashboard's trends, momentum/velocity, and price-drop / OOS alerts — none of
 * which the latest-snapshot `oliveyoung_global_products` table can express.
 *
 * No FK to the products table: snapshots are an append-only observation log and
 * must survive even if the current clean row is pruned. Idempotent on
 * (product_id, captured_at) — re-loading the same day refreshes that day's row.
 */
export const oliveyoungGlobalProductSnapshots = pgTable(
  "oliveyoung_global_product_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: text("product_id").notNull(),
    capturedAt: date("captured_at").notNull(),
    regularPrice: numeric("regular_price", { precision: 12, scale: 2 }),
    salePrice: numeric("sale_price", { precision: 12, scale: 2 }),
    discountRate: numeric("discount_rate", { precision: 5, scale: 2 }),
    avgRating: numeric("avg_rating", { precision: 3, scale: 2 }),
    reviewCount: integer("review_count"),
    stockQty: integer("stock_qty"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("oyg_snapshots_product_date_unique").on(table.productId, table.capturedAt),
    index("oyg_snapshots_captured_at_idx").on(table.capturedAt),
    index("oyg_snapshots_product_id_idx").on(table.productId),
  ],
);
