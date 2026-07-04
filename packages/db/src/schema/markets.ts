import { char, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Country/geography master data. */
export const markets = pgTable("markets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  code: char("code", { length: 2 }).notNull().unique(),
  region: text("region"),
  flag: text("flag"),
  regulatoryAuthority: text("regulatory_authority"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
