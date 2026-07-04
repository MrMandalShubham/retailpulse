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
