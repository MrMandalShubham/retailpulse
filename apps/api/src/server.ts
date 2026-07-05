import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "@dip/config";
import { dbPlugin } from "./plugins/db.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { ingestionRoutes } from "./modules/ingestion/ingestion.routes.js";
import { transformsRoutes } from "./modules/transforms/transforms.routes.js";
import { aiReviewsRoutes } from "./modules/ai-reviews/ai-reviews.routes.js";
import { productsRoutes } from "./modules/products/products.routes.js";
import { promotionRoutes } from "./modules/promotion/promotion.routes.js";

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
  app.register(transformsRoutes);
  app.register(aiReviewsRoutes);
  app.register(productsRoutes);
  app.register(promotionRoutes);

  // Internal operator dashboard (Phase 5 shell): a single static page over the
  // JSON APIs — no framework, no build step. Located in apps/api/public/.
  app.register(fastifyStatic, {
    root: fileURLToPath(new URL("../public", import.meta.url)),
    serve: false,
  });
  app.get("/dashboard", (_request, reply) => reply.sendFile("dashboard.html"));

  return app;
}
