import { sql } from "drizzle-orm";
import { check, date, index, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { markets } from "./markets.js";
import { productsMaster } from "./products.js";

/**
 * Monthly analytical review metrics per product, market, and platform.
 * V1 uses ONLY this monthly analytical version (approved decision) — alert-style
 * fields belong to a separate future table. Append-only in V1.
 */
export const voicePulseReviews = pgTable(
  "voice_pulse_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => productsMaster.id),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    platform: text("platform").notNull(),
    periodMonth: date("period_month").notNull(),
    avgRating: numeric("avg_rating", { precision: 3, scale: 2 }),
    reviewCount: integer("review_count"),
    recommendationPct: numeric("recommendation_pct", { precision: 5, scale: 2 }),
    repurchasePct: numeric("repurchase_pct", { precision: 5, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "voice_pulse_reviews_avg_rating_check",
      sql`${table.avgRating} >= 0 AND ${table.avgRating} <= 5`,
    ),
    check("voice_pulse_reviews_review_count_check", sql`${table.reviewCount} >= 0`),
    check(
      "voice_pulse_reviews_recommendation_pct_check",
      sql`${table.recommendationPct} >= 0 AND ${table.recommendationPct} <= 100`,
    ),
    check(
      "voice_pulse_reviews_repurchase_pct_check",
      sql`${table.repurchasePct} >= 0 AND ${table.repurchasePct} <= 100`,
    ),
    index("voice_pulse_reviews_series_idx").on(
      table.productId,
      table.marketId,
      table.platform,
      table.periodMonth,
    ),
    index("voice_pulse_reviews_market_id_idx").on(table.marketId),
    index("voice_pulse_reviews_period_month_idx").on(table.periodMonth),
  ],
);
