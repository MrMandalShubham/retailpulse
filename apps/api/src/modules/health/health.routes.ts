import type { FastifyInstance } from "fastify";
import { sql } from "@dip/db";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /** Liveness: the process is up. Never touches dependencies. */
  app.get("/health", async () => ({
    status: "ok",
    service: "dip-engine-api",
    uptimeSeconds: Math.round(process.uptime()),
  }));

  /** Readiness: the process can serve traffic (database reachable). */
  app.get("/health/ready", async (request, reply) => {
    try {
      await app.db.execute(sql`SELECT 1`);
      return { status: "ready", database: "up" };
    } catch (err) {
      request.log.error(err, "readiness check failed: database unreachable");
      return reply.status(503).send({ status: "not_ready", database: "down" });
    }
  });
}
