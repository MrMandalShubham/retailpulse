import { char, date, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { markets } from "./markets.js";
import { productsMaster } from "./products.js";

/**
 * Weekly price facts per product, market, and retailer. Append-only in V1.
 * The (product_id, market_id, retailer, week_ending) index is deliberately
 * NON-unique for now (approved decision) — the uniqueness rule may be added later.
 */
export const retailPulsePrices = pgTable(
  "retail_pulse_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => productsMaster.id),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    retailer: text("retailer").notNull(),
    regularPrice: numeric("regular_price", { precision: 12, scale: 2 }),
    promoPrice: numeric("promo_price", { precision: 12, scale: 2 }),
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    weekEnding: date("week_ending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("retail_pulse_prices_series_idx").on(
      table.productId,
      table.marketId,
      table.retailer,
      table.weekEnding,
    ),
    index("retail_pulse_prices_market_id_idx").on(table.marketId),
    index("retail_pulse_prices_week_ending_idx").on(table.weekEnding),
  ],
);
