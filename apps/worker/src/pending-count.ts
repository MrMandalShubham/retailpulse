/**
 * Print the number of pending products for a source slug.
 * Used by CI to decide whether discovery is needed.
 *
 *   pnpm pending-count [slug]
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { loadConfig } from "@dip/config";
import { createDb, eq, and, sql, schema } from "@dip/db";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const slug = process.argv[2] ?? "oliveyoung-global";

const dpp = schema.discoveredProductPages;
const src = schema.sources;

const [row] = await db
  .select({ count: sql<number>`count(*)::int` })
  .from(dpp)
  .innerJoin(src, eq(src.id, dpp.sourceId))
  .where(and(eq(src.slug, slug), eq(dpp.batchStatus, "pending")));

console.log(String(row?.count ?? 0));
await pool.end();
