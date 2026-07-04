import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

export interface DbConnection {
  db: NodePgDatabase<typeof schema>;
  pool: pg.Pool;
}

/**
 * Creates a pooled Postgres connection wrapped in Drizzle.
 * Callers own the lifecycle: call pool.end() on shutdown.
 */
export function createDb(connectionString: string): DbConnection {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Db = DbConnection["db"];
