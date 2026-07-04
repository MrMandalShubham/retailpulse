import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "@dip/config";
import { dbPlugin } from "./plugins/db.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { ingestionRoutes } from "./modules/ingestion/ingestion.routes.js";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
  }
}

/**
 * App factory, separated from main.ts so tests can build the server without
 * binding a port or requiring a live database.
 */
export function buildServer(config: AppConfig): FastifyInstance {
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: config.LOG_LEVEL },
  });

  app.decorate("config", config);
  app.register(dbPlugin, { connectionString: config.DATABASE_URL });
  app.register(healthRoutes);
  app.register(ingestionRoutes);

  // Future modules register here as their phases arrive:
  //   catalog, taxonomy, markets, pricing, reviews (Phase 4 — Query API)
  // See src/modules/* for the placeholder boundaries.

  return app;
}
