import { sql, type Db } from "@dip/db";

/**
 * Distribute step — rebuild the dashboard SERVING tables as pure projections of
 * `oliveyoung_global_products` (+ snapshots). Set-based, idempotent upserts run
 * in dependency order (dimensions → facts). Re-runnable any time; nothing here
 * is a source of truth. No new data is fetched.
 */

export interface DistributeLogger {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** retail_products mirrors the clean store 1:1 — identical column names. */
const MIRROR_COLS = [
  "name_en",
  "brand_name",
  "brand_name_kr",
  "category_l1",
  "category_l2",
  "category_l3",
  "regular_price",
  "sale_price",
  "discount_rate",
  "currency",
  "min_coupon_price",
  "stock_qty",
  "sell_status_code",
  "is_best",
  "is_new",
  "primary_image",
  "review_count",
  "avg_rating",
  "media_review_count",
  "product_name",
  "size_value",
  "size_unit",
  "set_type",
  "composition",
  "source_url",
  "ingredients",
  "how_to_use",
  "selling_point",
  "why_we_love_it",
];

/** The market our Olive Young Global products belong to (Korea's cross-border store).
 *  Per-source constant — a future platform sets its own market. */
const MARKET_NAME = "Korea (Global)";
const MARKET_CODE = "XG";

const retailProductsSql = `
INSERT INTO retail_products (product_id, ${MIRROR_COLS.join(", ")}, market, market_code, updated_at)
SELECT product_id, ${MIRROR_COLS.join(", ")}, '${MARKET_NAME}', '${MARKET_CODE}', now()
FROM oliveyoung_global_products
ON CONFLICT (product_id) DO UPDATE SET
  ${MIRROR_COLS.map((c) => `${c} = EXCLUDED.${c}`).join(",\n  ")},
  market = EXCLUDED.market,
  market_code = EXCLUDED.market_code,
  updated_at = now()`;

/** Steps run in order; each is a single idempotent statement. */
const STEPS: { name: string; sql: string }[] = [
  // --- dimensions ---
  {
    name: "markets",
    sql: `
      INSERT INTO markets (name, code, region, flag, regulatory_authority)
      VALUES ('Korea (Global)', 'XG', 'Asia', '🇰🇷', NULL)
      ON CONFLICT (code) DO NOTHING`,
  },
  {
    name: "brands",
    sql: `
      INSERT INTO brands (code, name, name_kr)
      SELECT DISTINCT ON (brand_no) brand_no, brand_name, brand_name_kr
      FROM oliveyoung_global_products
      WHERE brand_no IS NOT NULL AND brand_name IS NOT NULL
      ORDER BY brand_no, updated_at DESC
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, name_kr = EXCLUDED.name_kr`,
  },
  {
    name: "categories",
    sql: `
      INSERT INTO categories (path, l1, l2, l3, name)
      SELECT DISTINCT
        concat_ws(' > ', category_l1, category_l2, category_l3) AS path,
        category_l1, category_l2, category_l3,
        COALESCE(category_l3, category_l2, category_l1) AS name
      FROM oliveyoung_global_products
      WHERE category_l1 IS NOT NULL
      ON CONFLICT (path) DO NOTHING`,
  },

  // --- facts ---
  { name: "retail_products", sql: retailProductsSql },
  {
    name: "products_master",
    sql: `
      INSERT INTO products_master (
        slug, name, barcode, domain, category_id, brand_id, launch_date,
        price_benchmark_usd, market_status, market, market_code, primary_image_url,
        data_source, verified, data_quality_score, is_best, is_new, source_url,
        how_to_use, ingredients_text, sale_price, discount_rate, is_set, updated_at
      )
      SELECT
        trim(both '-' from lower(regexp_replace(
          trim(COALESCE(p.brand_name, '') || ' ' || COALESCE(p.product_name, p.name_en, p.product_id)),
          '[^a-z0-9]+', '-', 'gi'))),
        COALESCE(p.product_name, p.name_en),
        p.barcode,
        'Cosmetics',
        c.id,
        b.id,
        p.release_date,
        p.sale_price,
        CASE WHEN p.sell_status_code = '10' THEN 'Launched' ELSE 'Unknown' END,
        '${MARKET_NAME}',
        '${MARKET_CODE}',
        p.primary_image,
        'Olive Young Global',
        false,
        round(100.0 * (
          (p.barcode IS NOT NULL)::int + (p.sale_price IS NOT NULL)::int +
          (p.primary_image IS NOT NULL)::int + (p.avg_rating IS NOT NULL)::int +
          (p.ingredients IS NOT NULL)::int + (p.category_l3 IS NOT NULL)::int +
          (p.release_date IS NOT NULL)::int
        ) / 7.0)::int,
        p.is_best,
        p.is_new,
        p.source_url,
        p.how_to_use,
        p.ingredients,
        p.sale_price,
        p.discount_rate,
        (p.set_type IS NOT NULL),
        now()
      FROM oliveyoung_global_products p
      LEFT JOIN brands b ON b.code = p.brand_no
      LEFT JOIN categories c
        ON c.path = concat_ws(' > ', p.category_l1, p.category_l2, p.category_l3)
      WHERE p.source_url IS NOT NULL AND p.source_url <> ''
      ON CONFLICT (source_url) DO UPDATE SET
        name = EXCLUDED.name,
        barcode = EXCLUDED.barcode,
        category_id = EXCLUDED.category_id,
        brand_id = EXCLUDED.brand_id,
        launch_date = EXCLUDED.launch_date,
        price_benchmark_usd = EXCLUDED.price_benchmark_usd,
        market_status = EXCLUDED.market_status,
        market = EXCLUDED.market,
        market_code = EXCLUDED.market_code,
        primary_image_url = EXCLUDED.primary_image_url,
        data_quality_score = EXCLUDED.data_quality_score,
        is_best = EXCLUDED.is_best,
        is_new = EXCLUDED.is_new,
        how_to_use = EXCLUDED.how_to_use,
        ingredients_text = EXCLUDED.ingredients_text,
        sale_price = EXCLUDED.sale_price,
        discount_rate = EXCLUDED.discount_rate,
        is_set = EXCLUDED.is_set,
        updated_at = now()`,
  },
  {
    name: "product_ingredients",
    sql: `
      INSERT INTO product_ingredients (product_id, product_name, ingredients)
      SELECT product_id, product_name, key_ingredients
      FROM oliveyoung_global_products
      WHERE key_ingredients IS NOT NULL AND array_length(key_ingredients, 1) > 0
      ON CONFLICT (product_id) DO UPDATE SET
        product_name = EXCLUDED.product_name,
        ingredients = EXCLUDED.ingredients`,
  },
  {
    name: "voice_pulse_sentiment",
    sql: `
      WITH stars AS (
        SELECT p.brand_no,
               (elem->>'star')::int AS star,
               SUM((elem->>'count')::int) AS cnt
        FROM oliveyoung_global_products p,
             LATERAL jsonb_array_elements(COALESCE(p.star_breakdown, '[]'::jsonb)) elem
        WHERE p.brand_no IS NOT NULL
        GROUP BY p.brand_no, (elem->>'star')::int
      ),
      brand_stars AS (
        SELECT brand_no,
               SUM(cnt) AS total,
               SUM(cnt) FILTER (WHERE star >= 4) AS pos,
               SUM(cnt) FILTER (WHERE star = 3) AS neu,
               SUM(cnt) FILTER (WHERE star <= 2) AS neg
        FROM stars GROUP BY brand_no
      ),
      brand_agg AS (
        SELECT p.brand_no,
               COALESCE(SUM(p.review_count), 0) AS mentions,
               CASE WHEN SUM(p.review_count) > 0
                    THEN SUM(p.avg_rating * p.review_count) / NULLIF(SUM(p.review_count), 0)
                    ELSE AVG(p.avg_rating) END AS wavg,
               MIN(p.release_date) AS first_release
        FROM oliveyoung_global_products p
        WHERE p.brand_no IS NOT NULL
        GROUP BY p.brand_no
      )
      INSERT INTO voice_pulse_sentiment (
        brand_id, market_id, platform, period_month, sentiment_score,
        mention_count, positive_pct, negative_pct, neutral_pct,
        velocity_score, first_mention_date
      )
      SELECT
        b.id, m.id, 'Olive Young Global', date_trunc('month', now())::date,
        round((ba.wavg / 5.0)::numeric, 3),
        ba.mentions,
        CASE WHEN bs.total > 0 THEN round(100.0 * bs.pos / bs.total, 2) END,
        CASE WHEN bs.total > 0 THEN round(100.0 * bs.neg / bs.total, 2) END,
        CASE WHEN bs.total > 0 THEN round(100.0 * bs.neu / bs.total, 2) END,
        NULL,
        ba.first_release
      FROM brand_agg ba
      JOIN brands b ON b.code = ba.brand_no
      LEFT JOIN brand_stars bs ON bs.brand_no = ba.brand_no
      CROSS JOIN (SELECT id FROM markets WHERE code = 'XG' LIMIT 1) m
      ON CONFLICT (brand_id, market_id, platform, period_month) DO UPDATE SET
        sentiment_score = EXCLUDED.sentiment_score,
        mention_count = EXCLUDED.mention_count,
        positive_pct = EXCLUDED.positive_pct,
        negative_pct = EXCLUDED.negative_pct,
        neutral_pct = EXCLUDED.neutral_pct,
        first_mention_date = EXCLUDED.first_mention_date`,
  },
  {
    // review-volume proxy: units_sold = review_count as the demand weight;
    // shares/rank computed within (category, subcategory) for the current
    // quarter, Global market. Revenue side left null (no sales in the source).
    name: "product_category_share",
    sql: `
      WITH base AS (
        SELECT p.product_id,
               COALESCE(p.product_name, p.name_en) AS product_name,
               p.brand_name,
               p.category_l1 AS category,
               p.category_l2 AS subcategory,
               COALESCE(p.review_count, 0)::bigint AS units
        FROM oliveyoung_global_products p
        WHERE p.category_l1 IS NOT NULL AND p.category_l2 IS NOT NULL
      ),
      sub_tot AS (
        SELECT category, subcategory, SUM(units) AS sub_units
        FROM base GROUP BY category, subcategory
      ),
      cat_tot AS (
        SELECT category, SUM(units) AS cat_units FROM base GROUP BY category
      ),
      ranked AS (
        SELECT b.*, st.sub_units, ct.cat_units,
               DENSE_RANK() OVER (
                 PARTITION BY b.category, b.subcategory ORDER BY b.units DESC
               )::int AS rnk
        FROM base b
        JOIN sub_tot st ON st.category = b.category AND st.subcategory = b.subcategory
        JOIN cat_tot ct ON ct.category = b.category
      )
      INSERT INTO product_category_share (
        product_id, product_name, product_slug, brand_name, brand_slug, is_tracked,
        market, market_code, category, subcategory,
        period_type, period_label, period_start, period_end,
        units_sold, total_subcategory_units, total_category_units,
        units_subcategory_share_pct, units_category_share_pct,
        rank_in_subcategory, rank_change, change_pct
      )
      SELECT
        r.product_id,
        r.product_name,
        trim(both '-' from lower(regexp_replace(
          trim(COALESCE(r.brand_name, '') || ' ' || r.product_name), '[^a-z0-9]+', '-', 'gi'))),
        r.brand_name,
        trim(both '-' from lower(regexp_replace(COALESCE(r.brand_name, ''), '[^a-z0-9]+', '-', 'gi'))),
        false,
        'Korea (Global)', 'XG',
        r.category, r.subcategory,
        'quarterly',
        to_char(now(), 'YYYY') || '-Q' || to_char(now(), 'Q'),
        date_trunc('quarter', now())::date,
        (date_trunc('quarter', now()) + interval '3 months' - interval '1 day')::date,
        r.units, r.sub_units, r.cat_units,
        CASE WHEN r.sub_units > 0 THEN round(100.0 * r.units / r.sub_units, 3) END,
        CASE WHEN r.cat_units > 0 THEN round(100.0 * r.units / r.cat_units, 3) END,
        r.rnk, 0, 0
      FROM ranked r
      ON CONFLICT (product_id, period_label, market_code) DO UPDATE SET
        product_name = EXCLUDED.product_name,
        product_slug = EXCLUDED.product_slug,
        brand_name = EXCLUDED.brand_name,
        brand_slug = EXCLUDED.brand_slug,
        category = EXCLUDED.category,
        subcategory = EXCLUDED.subcategory,
        units_sold = EXCLUDED.units_sold,
        total_subcategory_units = EXCLUDED.total_subcategory_units,
        total_category_units = EXCLUDED.total_category_units,
        units_subcategory_share_pct = EXCLUDED.units_subcategory_share_pct,
        units_category_share_pct = EXCLUDED.units_category_share_pct,
        rank_in_subcategory = EXCLUDED.rank_in_subcategory`,
  },
  {
    // monthly per-product row for the current month; units_sold = review_count
    // proxy, revenue null (no sales in the source). Global/XG, USD.
    name: "product_sales_history",
    sql: `
      INSERT INTO product_sales_history (
        product_id, product_slug, retailer, market, currency,
        period_type, period_label, period_start, period_end,
        units_sold, last_updated
      )
      SELECT
        p.product_id,
        trim(both '-' from lower(regexp_replace(
          trim(COALESCE(p.brand_name, '') || ' ' || COALESCE(p.product_name, p.name_en, p.product_id)),
          '[^a-z0-9]+', '-', 'gi'))),
        'Olive Young',
        'Korea (Global)',
        'USD',
        'monthly',
        to_char(now(), 'YYYY-MM'),
        date_trunc('month', now())::date,
        (date_trunc('month', now()) + interval '1 month' - interval '1 day')::date,
        COALESCE(p.review_count, 0)::bigint,
        now()
      FROM oliveyoung_global_products p
      ON CONFLICT (product_id, period_label) DO UPDATE SET
        product_slug = EXCLUDED.product_slug,
        units_sold = EXCLUDED.units_sold,
        last_updated = now()`,
  },
  {
    // brand share within a category (current quarter, Global/XG). units_sold =
    // brand's summed review_count; units_share_pct = brand ÷ category review
    // volume. Revenue + market_share_pct (revenue share) left null.
    name: "brand_market_share",
    sql: `
      WITH brand_cat AS (
        -- group by the computed slug so same-slug brands can't collide on the
        -- (brand_slug, category, …) conflict key within one statement.
        SELECT
          trim(both '-' from lower(regexp_replace(brand_name, '[^a-z0-9]+', '-', 'gi'))) AS brand_slug,
          max(brand_name) AS brand_name,
          category_l1 AS category,
          SUM(COALESCE(review_count, 0))::bigint AS units
        FROM oliveyoung_global_products
        WHERE brand_name IS NOT NULL AND category_l1 IS NOT NULL
        GROUP BY 1, category_l1
      ),
      cat_tot AS (
        SELECT category, SUM(units) AS cat_units FROM brand_cat GROUP BY category
      ),
      ranked AS (
        SELECT bc.*, ct.cat_units,
               DENSE_RANK() OVER (PARTITION BY bc.category ORDER BY bc.units DESC)::int AS rnk
        FROM brand_cat bc JOIN cat_tot ct ON ct.category = bc.category
      )
      INSERT INTO brand_market_share (
        brand_name, brand_slug, is_tracked, market, market_code, category,
        period_type, period_label, period_start, period_end,
        units_sold, currency, total_category_units,
        units_share_pct, rank_in_category, rank_change, change_pct
      )
      SELECT
        r.brand_name,
        r.brand_slug,
        false,
        'Korea (Global)', 'XG',
        r.category,
        'quarterly',
        to_char(now(), 'YYYY') || '-Q' || to_char(now(), 'Q'),
        date_trunc('quarter', now())::date,
        (date_trunc('quarter', now()) + interval '3 months' - interval '1 day')::date,
        r.units, 'USD', r.cat_units,
        CASE WHEN r.cat_units > 0 THEN round(100.0 * r.units / r.cat_units, 3) END,
        r.rnk, 0, 0
      FROM ranked r
      ON CONFLICT (brand_slug, category, period_label, market_code) DO UPDATE SET
        brand_name = EXCLUDED.brand_name,
        units_sold = EXCLUDED.units_sold,
        total_category_units = EXCLUDED.total_category_units,
        units_share_pct = EXCLUDED.units_share_pct,
        rank_in_category = EXCLUDED.rank_in_category`,
  },
  {
    // weekly shelf presence. oos_pct (stock) + promo_pct (discount) are REAL;
    // shelf_share_pct = review share within subcategory (proxy); facings null.
    // FKs resolved: product_id ← products_master.id (via source_url), market ← XG.
    name: "retail_pulse_shelf_share",
    sql: `
      WITH base AS (
        SELECT p.source_url, p.category_l2 AS subcat,
               COALESCE(p.review_count, 0)::bigint AS units,
               p.stock_qty, p.discount_rate
        FROM oliveyoung_global_products p
        WHERE p.source_url IS NOT NULL AND p.source_url <> ''
      ),
      sub_tot AS (
        SELECT subcat, SUM(units) AS su FROM base WHERE subcat IS NOT NULL GROUP BY subcat
      )
      INSERT INTO retail_pulse_shelf_share (
        product_id, market_id, retailer, shelf_share_pct, oos_pct, promo_pct, week_ending, source
      )
      SELECT
        pm.id, m.id, 'Olive Young',
        CASE WHEN st.su > 0 THEN round(100.0 * b.units / st.su, 3) END,
        CASE WHEN COALESCE(b.stock_qty, 0) <= 0 THEN 100.0 ELSE 0.0 END,
        COALESCE(b.discount_rate, 0),
        (date_trunc('week', now()) + interval '6 days')::date,
        'API'
      FROM base b
      JOIN products_master pm ON pm.source_url = b.source_url
      LEFT JOIN sub_tot st ON st.subcat = b.subcat
      CROSS JOIN (SELECT id FROM markets WHERE code = 'XG' LIMIT 1) m
      ON CONFLICT (product_id, market_id, week_ending) DO UPDATE SET
        shelf_share_pct = EXCLUDED.shelf_share_pct,
        oos_pct = EXCLUDED.oos_pct,
        promo_pct = EXCLUDED.promo_pct,
        retailer = EXCLUDED.retailer`,
  },
];

export async function runDistribute(
  db: Db,
  logger: DistributeLogger,
): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  for (const step of STEPS) {
    const res = await db.execute(sql.raw(step.sql));
    const rows = (res as { rowCount?: number }).rowCount ?? 0;
    results[step.name] = rows;
    logger.info({ step: step.name, rows }, "distributed");
  }
  return results;
}
