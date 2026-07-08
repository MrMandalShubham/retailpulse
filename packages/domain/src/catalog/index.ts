/**
 * Catalog domain — canonical products (products_master) and brands.
 * products_master is the hub of the V1 schema: every clean product ends here.
 */

export const PRICE_SEGMENTS = [
  "Luxury",
  "Premium",
  "Mass_Market",
  "Drugstore",
  "Professional",
] as const;
export type PriceSegment = (typeof PRICE_SEGMENTS)[number];

export const BRAND_TIERS = ["Luxury", "Premium", "Mass", "Indie", "Professional"] as const;
export type BrandTier = (typeof BRAND_TIERS)[number];

/** Global lifecycle status of a canonical product (products_master.market_status). */
export const MARKET_STATUSES = ["Active", "Discontinued", "Coming_Soon"] as const;
export type MarketStatus = (typeof MARKET_STATUSES)[number];

/** Canonical product record (products_master). Dates are ISO-8601 strings. */
export interface Product {
  id: string;
  slug: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  description: string | null;
  domain: string | null;
  categoryId: string | null;
  productTypeId: string | null;
  brandId: string | null;
  priceSegment: PriceSegment | null;
  /** No FK in V1 — textures master table is not part of the 8-table core. */
  textureId: string | null;
  skinTypes: string[] | null;
  skinConcerns: string[] | null;
  spfValue: number | null;
  keyClaims: string[] | null;
  /** Phase 7 enrichment fields (fill-if-null). */
  paRating: string | null;
  texture: string | null;
  ingredientHighlights: string[] | null;
  sizeValue: number | null;
  sizeUnit: string | null;
  launchDate: string | null;
  discontinuationDate: string | null;
  priceBenchmarkUsd: number | null;
  marketStatus: MarketStatus | null;
  targetAgeGroup: string | null;
  primaryImageUrl: string | null;
  dataQualityScore: number | null;
  dataSource: string | null;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Canonical brand identity (brands). */
export interface Brand {
  id: string;
  slug: string;
  name: string;
  /** No FK in V1 — companies master table is not part of the 8-table core. */
  parentCompanyId: string | null;
  brandTier: BrandTier | null;
  countryOfOrigin: string | null;
  marketId: string | null;
  foundingYear: number | null;
  sustainabilityRating: string | null;
  description: string | null;
  logoUrl: string | null;
  website: string | null;
  createdAt: string;
  updatedAt: string;
}

// TODO(Phase 4): repository/service contracts for product queries (findBySlug,
// filtered listing by market/category/brand) are defined here when the Query API
// endpoints are implemented.
