import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "@dip/config";
import { dbPlugin } from "./plugins/db.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { ingestionRoutes } from "./modules/ingestion/ingestion.routes.js";
import { monitoringRoutes } from "./modules/monitoring/monitoring.routes.js";

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
  app.register(monitoringRoutes);

  // Static internal page (no framework, no build step) in apps/api/public/:
  //   /monitoring  — DIP Engine observability & data-quality console
  app.register(fastifyStatic, {
    root: fileURLToPath(new URL("../public", import.meta.url)),
    serve: false,
  });
  app.get("/monitoring", (_request, reply) => reply.sendFile("monitoring.html"));

  return app;
}
