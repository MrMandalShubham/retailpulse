/**
 * Media-store domain (Phase 9) — vocabularies + contracts for the normalized
 * media model. Binary files live in object storage (DO Spaces / MinIO); the DB
 * holds only references + metadata + linkage + provenance.
 *
 * Three tables:
 * - media_assets: one row per physical file (bucket + key + metadata), shared
 *   across products via the junction; deduped by checksum / source_url.
 * - product_media_links: product ↔ asset junction (role, sort, is_primary,
 *   market, source). At most one primary per product (DB-enforced).
 * - media_variants: derived renditions of an asset (thumbnail / webp / poster /
 *   transcode), each its own bucket object.
 *
 * Additive: does NOT touch the legacy Phase 5 `product_media` table or
 * `products_master.primary_image_url` (which keep their own vocabulary).
 */

/** Broad asset kind (superset of the legacy image/video product-media type). */
export const MEDIA_ASSET_TYPES = ["image", "video", "audio", "document", "other"] as const;
export type MediaAssetType = (typeof MEDIA_ASSET_TYPES)[number];

/** Where the bytes physically live. `external` = we only hold the origin URL. */
export const MEDIA_STORAGE_PROVIDERS = ["do_spaces", "minio", "s3", "gcs", "external"] as const;
export type MediaStorageProvider = (typeof MEDIA_STORAGE_PROVIDERS)[number];

/**
 * Lifecycle of an asset.
 * - referenced: only the origin URL is known (no bucket copy) — the current state.
 * - stored: bytes copied into our bucket.
 * - pending/approved/rejected/archived: reserved for a moderation workflow.
 */
export const MEDIA_ASSET_STATUSES = [
  "pending",
  "referenced",
  "stored",
  "approved",
  "rejected",
  "archived",
] as const;
export type MediaAssetStatus = (typeof MEDIA_ASSET_STATUSES)[number];

/** Where the media was sourced from. */
export const MEDIA_SOURCE_TYPES = [
  "product_page",
  "brand_reference",
  "marketplace",
  "cdn",
  "campaign",
  "other",
] as const;
export type MediaSourceType = (typeof MEDIA_SOURCE_TYPES)[number];

/** The role an asset plays in a product's report/gallery. */
export const MEDIA_ROLES = [
  "primary",
  "gallery",
  "detail",
  "ingredient",
  "before_after",
  "video_demo",
  "ad_creative",
  "packaging",
  "texture",
  "campaign",
  "swatch",
  "other",
] as const;
export type MediaRole = (typeof MEDIA_ROLES)[number];

/** Derived-rendition kind for media_variants. */
export const MEDIA_VARIANT_TYPES = [
  "thumbnail",
  "small",
  "medium",
  "large",
  "webp",
  "avif",
  "preview",
  "poster",
  "transcode_720p",
  "transcode_1080p",
  "compressed",
] as const;
export type MediaVariantType = (typeof MEDIA_VARIANT_TYPES)[number];

// --- Contracts ----------------------------------------------------------------

/** One physical stored/referenced media file (media_assets). */
export interface MediaAsset {
  id: string;
  storageProvider: MediaStorageProvider;
  bucketName: string | null;
  objectKey: string | null;
  canonicalUrl: string | null;
  mediaType: MediaAssetType;
  mimeType: string | null;
  fileExt: string | null;
  fileSizeBytes: number | null;
  checksum: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  sourceUrl: string | null;
  sourceType: MediaSourceType | null;
  originMarketId: string | null;
  sourceId: string | null;
  sourceSlug: string | null;
  altText: string | null;
  caption: string | null;
  assetStatus: MediaAssetStatus;
  qualityScore: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Product ↔ asset link (product_media_links). */
export interface ProductMediaLink {
  id: string;
  productId: string;
  mediaId: string;
  mediaRole: MediaRole;
  sortOrder: number;
  isPrimary: boolean;
  marketId: string | null;
  sourceId: string | null;
  sourceSlug: string | null;
  caption: string | null;
  createdAt: string;
}

/** Derived rendition of an asset (media_variants). */
export interface MediaVariant {
  id: string;
  mediaId: string;
  variantType: MediaVariantType;
  bucketName: string | null;
  objectKey: string | null;
  canonicalUrl: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  fileSizeBytes: number | null;
  durationSeconds: number | null;
  createdAt: string;
}
