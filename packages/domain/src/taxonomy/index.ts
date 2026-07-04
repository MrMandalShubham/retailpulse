/**
 * Taxonomy domain — hierarchical categories and their product types.
 * Master data: stable classification vocabulary used across the platform.
 */

export const PRODUCT_DOMAINS = [
  "Cosmetics",
  "Aesthetics",
  "Nutri_Cosmetics",
  "Oral_Care",
] as const;
export type ProductDomain = (typeof PRODUCT_DOMAINS)[number];

/** Category node (categories). Hierarchy is expressed via parentId (self-reference). */
export interface Category {
  id: string;
  name: string;
  slug: string;
  productDomain: ProductDomain | null;
  parentId: string | null;
  sortOrder: number;
  createdAt: string;
}

/** Sub-type under a category, e.g. Serum, Cream, Sunscreen (product_types). */
export interface ProductType {
  id: string;
  name: string;
  slug: string;
  categoryId: string;
  createdAt: string;
}
