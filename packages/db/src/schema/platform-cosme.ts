import { sql } from "drizzle-orm";
import {
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

/**
 * @cosme (アットコスメ, www.cosme.net) — clean per-platform product store for the
 * JAPAN market. Same role as oliveyoung_global_products: one fully-transformed,
 * typed row per product, written directly by Phase 1 ingestion. Nothing raw is
 * persisted; the map (discovered_product_pages) can re-drive a fresh fetch.
 *
 * @cosme differs from Olive Young in three ways, reflected here:
 *  - Source is server-rendered HTML (Shift_JIS) + embedded schema.org JSON-LD,
 *    not a JSON API. The clean step parses JSON-LD (name/brand/rating/reviews)
 *    plus the Shift_JIS "商品情報" block (price/size/release) and the ranking
 *    line (rank + category).
 *  - Japanese. Every human-facing field is stored BOTH as the original Japanese
 *    (`*_ja`) and an English translation (`*_en`, Mistral JA→EN at ingest).
 *    `source_hash` caches the translation: we re-translate only when the source
 *    Japanese changes (hash mismatch).
 *  - Rating is a 0–7 scale (bestRating 7). `rating_raw` keeps the native value;
 *    `rating` is normalized to 0–5 to match the shared serving layer. @cosme is
 *    a review aggregator (no storefront), so price is a reference price (JPY,
 *    "編集部調べ") and is often absent; stock/coupon/sell-status do not exist.
 */
export const cosmeJpProducts = pgTable(
  "cosme_jp_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // --- identity & lineage ---
    productId: text("product_id").notNull(), // @cosme product number (from /products/{id}/)
    sourceUrl: text("source_url").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),

    // --- name & brand (JA original + EN translation) ---
    nameJa: text("name_ja"), // JSON-LD Product.name (verbatim JA)
    nameEn: text("name_en"), // Mistral translation of name_ja
    productName: text("product_name"), // EN core name (brand stripped) for the serving mirror
    brandNo: text("brand_no"), // synthesized brand key (JSON-LD gives no id): 'jp-'||md5(brand)
    brandNameJa: text("brand_name_ja"), // JSON-LD Product.brand.name (verbatim JA)
    brandNameEn: text("brand_name_en"), // Mistral translation of brand_name_ja

    // --- category (from the ranking line "N位{category}"; JA + EN) ---
    categoryJa: text("category_ja"), // e.g. 口紅
    categoryEn: text("category_en"), // e.g. Lipstick (translation)
    rankInCategory: integer("rank_in_category"), // e.g. 2 (from "2位口紅")

    // --- rating & engagement ---
    ratingRaw: numeric("rating_raw", { precision: 4, scale: 2 }), // native 0–7 (JSON-LD ratingValue)
    rating: numeric("rating", { precision: 3, scale: 2 }), // normalized 0–5 for the serving layer
    ptScore: numeric("pt_score", { precision: 8, scale: 1 }), // @cosme proprietary "pt" score
    reviewCount: integer("review_count"), // JSON-LD reviewCount
    haveCount: integer("have_count"), // もってる (JS-loaded; usually null)
    wantCount: integer("want_count"), // 気になる (JS-loaded; usually null)

    // --- pricing (reference price only; JPY) ---
    price: numeric("price", { precision: 12, scale: 2 }), // first variant's 税込 price (JPY)
    currency: text("currency").notNull().default("JPY"),
    sizeValue: numeric("size_value", { precision: 10, scale: 2 }), // first variant's size number
    sizeUnit: text("size_unit"), // g / ml / 枚 …
    priceVariants: jsonb("price_variants"), // [{ label, price }] all 容量・税込価格 variants

    // --- content ---
    primaryImage: text("primary_image"), // OG / product CDN image (ASCII URL)
    descriptionJa: text("description_ja"), // og/meta description (JA) if cleanly present
    descriptionEn: text("description_en"), // translation
    keyIngredients: text("key_ingredients").array(), // parsed from EN text (usually empty — no INCI)
    releaseDate: date("release_date"), // 発売日

    // --- translation cache key ---
    // md5 of the concatenated JA source fields we translate; a mismatch on
    // re-ingest means the source changed and we re-translate (else reuse *_en).
    sourceHash: text("source_hash"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("cosme_products_product_id_unique").on(table.productId),
    index("cosme_products_brand_no_idx").on(table.brandNo),
    index("cosme_products_rating_idx").on(table.rating),
    check("cosme_products_rating_check", sql`${table.rating} >= 0 AND ${table.rating} <= 5`),
    check("cosme_products_review_count_check", sql`${table.reviewCount} >= 0`),
  ],
);

/**
 * Time-series snapshots — one row per product per capture date (rating / reviews
 * / rank / price). Append-only; idempotent on (product_id, captured_at). Mirrors
 * oliveyoung_global_product_snapshots so the dashboard's trend/momentum logic
 * treats both platforms the same.
 */
export const cosmeJpProductSnapshots = pgTable(
  "cosme_jp_product_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: text("product_id").notNull(),
    capturedAt: date("captured_at").notNull(),
    rating: numeric("rating", { precision: 3, scale: 2 }),
    ratingRaw: numeric("rating_raw", { precision: 4, scale: 2 }),
    reviewCount: integer("review_count"),
    rankInCategory: integer("rank_in_category"),
    price: numeric("price", { precision: 12, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("cosme_snapshots_product_date_unique").on(table.productId, table.capturedAt),
    index("cosme_snapshots_captured_at_idx").on(table.capturedAt),
    index("cosme_snapshots_product_id_idx").on(table.productId),
  ],
);
