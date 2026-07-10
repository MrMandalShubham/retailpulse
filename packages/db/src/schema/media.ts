import {
  MEDIA_ASSET_STATUSES,
  MEDIA_ASSET_TYPES,
  MEDIA_ROLES,
  MEDIA_SOURCE_TYPES,
  MEDIA_STORAGE_PROVIDERS,
  MEDIA_VARIANT_TYPES,
} from "@dip/domain";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { inList } from "./helpers.js";
import { sources } from "./ingestion.js";
import { markets } from "./markets.js";
import { productsMaster } from "./products.js";

/**
 * Media-store layer (Phase 9) — normalized, additive. Binary files stay in
 * object storage; these tables hold references + metadata + linkage +
 * provenance only. Does NOT touch the legacy Phase 5 `product_media` table or
 * `products_master.primary_image_url` — both remain live. A later, separately
 * approved step backfills the legacy rows and repoints the promotion writer.
 *
 * Object-key convention (keyed by immutable media_id so shared assets are never
 * duplicated in storage):
 *   media/assets/{media_id}/original.{ext}
 *   media/assets/{media_id}/variants/{variant_type}.{ext}
 */

/** One physical stored/referenced media file. Shared across products via links. */
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storageProvider: text("storage_provider").notNull().default("external"),
    bucketName: text("bucket_name"),
    objectKey: text("object_key"),
    canonicalUrl: text("canonical_url"),
    mediaType: text("media_type").notNull().default("image"),
    mimeType: text("mime_type"),
    fileExt: text("file_ext"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    checksum: text("checksum"),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: numeric("duration_seconds", { precision: 10, scale: 3 }),
    sourceUrl: text("source_url"),
    sourceType: text("source_type"),
    originMarketId: uuid("origin_market_id").references(() => markets.id, { onDelete: "set null" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    sourceSlug: text("source_slug"),
    altText: text("alt_text"),
    caption: text("caption"),
    assetStatus: text("asset_status").notNull().default("referenced"),
    qualityScore: numeric("quality_score", { precision: 4, scale: 3 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("media_assets_storage_provider_check", inList("storage_provider", MEDIA_STORAGE_PROVIDERS)),
    check("media_assets_media_type_check", inList("media_type", MEDIA_ASSET_TYPES)),
    check("media_assets_source_type_check", inList("source_type", MEDIA_SOURCE_TYPES)),
    check("media_assets_asset_status_check", inList("asset_status", MEDIA_ASSET_STATUSES)),
    check(
      "media_assets_quality_score_check",
      sql`${table.qualityScore} >= 0 AND ${table.qualityScore} <= 1`,
    ),
    check("media_assets_file_size_check", sql`${table.fileSizeBytes} >= 0`),
    // Dedup: one asset per file (checksum) / per origin (source_url) — idempotent
    // backfill and shared-asset normalization. Partial: referenced rows have nulls.
    uniqueIndex("media_assets_checksum_unique")
      .on(table.checksum)
      .where(sql`${table.checksum} IS NOT NULL`),
    uniqueIndex("media_assets_source_url_unique")
      .on(table.sourceUrl)
      .where(sql`${table.sourceUrl} IS NOT NULL`),
    index("media_assets_source_id_idx").on(table.sourceId),
    index("media_assets_origin_market_id_idx").on(table.originMarketId),
    index("media_assets_media_type_idx").on(table.mediaType),
    index("media_assets_asset_status_idx").on(table.assetStatus),
  ],
);

/** Product ↔ asset junction: role, order, primary flag, market/source context. */
export const productMediaLinks = pgTable(
  "product_media_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => productsMaster.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    mediaRole: text("media_role").notNull().default("gallery"),
    sortOrder: integer("sort_order").notNull().default(0),
    isPrimary: boolean("is_primary").notNull().default(false),
    marketId: uuid("market_id").references(() => markets.id, { onDelete: "set null" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    sourceSlug: text("source_slug"),
    caption: text("caption"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("product_media_links_media_role_check", inList("media_role", MEDIA_ROLES)),
    check("product_media_links_sort_order_check", sql`${table.sortOrder} >= 0`),
    // An asset may serve several roles for a product, but not duplicate one.
    uniqueIndex("product_media_links_product_media_role_unique").on(
      table.productId,
      table.mediaId,
      table.mediaRole,
    ),
    // At most one primary media per product (DB-enforced).
    uniqueIndex("product_media_links_one_primary_per_product")
      .on(table.productId)
      .where(sql`${table.isPrimary}`),
    index("product_media_links_product_id_idx").on(table.productId),
    index("product_media_links_media_id_idx").on(table.mediaId),
    index("product_media_links_market_id_idx").on(table.marketId),
    index("product_media_links_source_id_idx").on(table.sourceId),
    index("product_media_links_media_role_idx").on(table.mediaRole),
  ],
);

/** Derived renditions of an asset (thumbnails, webp, poster, transcodes). */
export const mediaVariants = pgTable(
  "media_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    variantType: text("variant_type").notNull(),
    bucketName: text("bucket_name"),
    objectKey: text("object_key"),
    canonicalUrl: text("canonical_url"),
    mimeType: text("mime_type"),
    width: integer("width"),
    height: integer("height"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    durationSeconds: numeric("duration_seconds", { precision: 10, scale: 3 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("media_variants_variant_type_check", inList("variant_type", MEDIA_VARIANT_TYPES)),
    check("media_variants_file_size_check", sql`${table.fileSizeBytes} >= 0`),
    // One rendition per type per asset.
    uniqueIndex("media_variants_media_variant_type_unique").on(table.mediaId, table.variantType),
    index("media_variants_media_id_idx").on(table.mediaId),
  ],
);
