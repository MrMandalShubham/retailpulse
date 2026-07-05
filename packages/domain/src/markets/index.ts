/**
 * Markets domain — country/geography master data and product availability.
 * product_markets is the bridge table: one product, many markets. Products are
 * never duplicated per country.
 */

export const PRODUCT_MARKET_STATUSES = ["Active", "Discontinued", "Coming_Soon"] as const;
export type ProductMarketStatus = (typeof PRODUCT_MARKET_STATUSES)[number];

/** Country/geography master record (markets). */
export interface Market {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2, e.g. "JP", "IN". */
  code: string;
  region: string | null;
  flag: string | null;
  regulatoryAuthority: string | null;
  createdAt: string;
}

/** Bridge record linking a canonical product to a market (product_markets). */
export interface ProductMarket {
  productId: string;
  marketId: string;
  launchDate: string | null;
  status: ProductMarketStatus;
  localName: string | null;
  localSku: string | null;
}

/**
 * Source→market mapping confidence (source_markets, Phase 6).
 * Mappings are created ONLY by seed/operator — never inferred by pipelines.
 * 'confirmed' mappings may create product_markets rows; 'inferred' may only
 * stamp market_id onto observation facts.
 */
export const SOURCE_MARKET_CONFIDENCES = ["confirmed", "inferred"] as const;
export type SourceMarketConfidence = (typeof SOURCE_MARKET_CONFIDENCES)[number];

/**
 * Internal cross-border market code (markets.code). 'XG' sits in the ISO 3166
 * user-assigned range — it is NOT a real ISO country code and must never be
 * presented as a country. It exists for sources that genuinely operate one
 * global cross-border storefront (e.g. Olive Young Global).
 */
export const CROSS_BORDER_MARKET_CODE = "XG";

/** Source→market mapping record (source_markets). */
export interface SourceMarket {
  id: string;
  sourceId: string;
  marketId: string;
  confidence: SourceMarketConfidence;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
