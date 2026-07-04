import { BRAND_TIERS } from "@dip/domain";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { inList } from "./helpers.js";
import { markets } from "./markets.js";

/** Canonical brand identity master data. */
export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    // Nullable, no FK: the companies master table is not part of the V1 core.
    // The FK constraint is added in the phase that introduces companies.
    parentCompanyId: uuid("parent_company_id"),
    brandTier: text("brand_tier"),
    countryOfOrigin: text("country_of_origin"),
    marketId: uuid("market_id").references(() => markets.id),
    foundingYear: integer("founding_year"),
    sustainabilityRating: text("sustainability_rating"),
    description: text("description"),
    logoUrl: text("logo_url"),
    website: text("website"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("brands_brand_tier_check", inList("brand_tier", BRAND_TIERS)),
    index("brands_market_id_idx").on(table.marketId),
  ],
);
