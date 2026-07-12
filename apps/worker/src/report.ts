/**
 * Phase 11 (Publish layer, first cut) — generate per-product "report card"
 * HTML from canonical data. Read-only: joins products_master with brand /
 * category / product_type / source / price and renders one card per product.
 * Every field is either real canonical data or an honest "—" (never invented).
 *
 * Run via `pnpm report:run` (optionally `pnpm report:run <limit> <outfile>`).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { loadConfig } from "@dip/config";
import { createDb, desc, eq, schema, sql } from "@dip/db";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const limit = Number.parseInt(process.argv[2] ?? "12", 10);
const outFile = process.argv[3] ?? "report-cards.html";
const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);

const pm = schema.productsMaster;
const rows = await db
  .select({
    id: pm.id,
    name: pm.name,
    description: pm.description,
    priceUsd: pm.priceBenchmarkUsd,
    image: pm.primaryImageUrl,
    quality: pm.dataQualityScore,
    domain: pm.domain,
    sizeValue: pm.sizeValue,
    sizeUnit: pm.sizeUnit,
    texture: pm.texture,
    spf: pm.spfValue,
    brand: schema.brands.name,
    category: schema.categories.name,
    productType: schema.productTypes.name,
    sourceUrl: sql<string | null>`(select ps.source_url from ${schema.productSources} ps where ps.product_id = ${pm.id} limit 1)`,
    market: sql<string | null>`(select m.name from ${schema.productMarkets} pmk join ${schema.markets} m on m.id = pmk.market_id where pmk.product_id = ${pm.id} limit 1)`,
  })
  .from(pm)
  .leftJoin(schema.brands, eq(pm.brandId, schema.brands.id))
  .leftJoin(schema.categories, eq(pm.categoryId, schema.categories.id))
  .leftJoin(schema.productTypes, eq(pm.productTypeId, schema.productTypes.id))
  .orderBy(desc(pm.dataQualityScore))
  .limit(Number.isFinite(limit) ? limit : 12);

const esc = (s: unknown): string =>
  s == null || s === ""
    ? "—"
    : String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const size = (v: unknown, u: unknown): string => (v == null ? "—" : `${String(v)} ${u ?? ""}`.trim());
const price = (v: unknown): string => (v == null ? "—" : `USD ${Number(v).toFixed(2)}`);

function card(r: (typeof rows)[number]): string {
  return `
  <article class="card">
    <header class="chead">${esc(r.category)}<span class="q">DQ ${esc(r.quality)}</span></header>
    <div class="body">
      <dl class="ident">
        <dt>BRAND</dt><dd>${esc(r.brand)}</dd>
        <dt>NAMING</dt><dd>${esc(r.name)}</dd>
        <dt>TYPE</dt><dd>${esc(r.productType)}</dd>
        <dt>MARKET</dt><dd>${esc(r.market)}${r.market === "Global (Cross-border)" ? " 🌐" : ""}</dd>
        <dt>PRICE</dt><dd class="price">${price(r.priceUsd)}</dd>
        <dt>SIZE</dt><dd>${esc(size(r.sizeValue, r.sizeUnit))}</dd>
        <dt>DOMAIN</dt><dd>${esc(r.domain)}</dd>
        <dt>SPF</dt><dd>${esc(r.spf)}</dd>
      </dl>
      <div class="media">${r.image ? `<img src="${esc(r.image)}" alt="${esc(r.name)}" loading="lazy"/>` : `<div class="noimg">no image</div>`}</div>
    </div>
    <footer class="src">SOURCE: ${r.sourceUrl ? `<a href="${esc(r.sourceUrl)}">${esc(r.sourceUrl)}</a>` : "—"}</footer>
  </article>`;
}

const style = `<style>
  .report { font: 13px/1.5 system-ui, sans-serif; color: #2b2330; }
  .report h1 { font-size: 18px; letter-spacing: .04em; color: #b56a7a; margin: 0 0 4px; }
  .report .sub { color: #8a7d86; margin: 0 0 18px; font-size: 12px; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
  .card { border: 1px solid #eddfe4; border-radius: 12px; overflow: hidden; background: #fff; }
  .chead { background: #f7e5ea; color: #a4536a; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
           padding: 8px 12px; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }
  .chead .q { font-weight: 500; color: #b58; font-size: 11px; }
  .body { display: flex; gap: 12px; padding: 12px; }
  .ident { flex: 1; margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; align-content: start; }
  .ident dt { color: #b56a7a; font-size: 10px; font-weight: 700; letter-spacing: .05em; align-self: center; }
  .ident dd { margin: 0; font-size: 12.5px; }
  .ident dd.price { font-weight: 700; color: #2b2330; }
  .media { width: 96px; flex: none; }
  .media img { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; border: 1px solid #eddfe4; }
  .noimg { width: 96px; height: 96px; border-radius: 8px; background: #f5eef1; color: #b8a; display: grid; place-items: center; font-size: 10px; }
  .src { padding: 8px 12px; border-top: 1px solid #f2e7eb; font-size: 10.5px; color: #9a8d94; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .src a { color: #a4536a; }
</style>`;

const html = `<div class="report">${style}
  <h1>DIP Engine — Product Report Cards</h1>
  <p class="sub">${rows.length} canonical products · source: Olive Young Global · fields shown are real canonical data (— = not captured yet)</p>
  <div class="grid">${rows.map(card).join("\n")}</div>
</div>`;

writeFileSync(outFile, html, "utf8");
console.log(`wrote ${rows.length} report cards to ${outFile}`);
await pool.end();
