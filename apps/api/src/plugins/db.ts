import fp from "fastify-plugin";
import { createDb, type Db, type DbConnection } from "@dip/db";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    pgPool: DbConnection["pool"];
  }
}

interface DbPluginOptions {
  connectionString: string;
}

/**
 * Wires the shared Drizzle/pg connection into the Fastify lifecycle.
 * The pool connects lazily on first query and is drained on server close.
 */
export const dbPlugin = fp<DbPluginOptions>(
  async (app, opts) => {
    const { db, pool } = createDb(opts.connectionString);
    app.decorate("db", db);
    app.decorate("pgPool", pool);
    app.addHook("onClose", async () => {
      await pool.end();
    });
  },
  { name: "dip-db" },
);
