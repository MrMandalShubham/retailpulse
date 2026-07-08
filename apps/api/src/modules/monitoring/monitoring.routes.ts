import type { FastifyInstance } from "fastify";
import { CORE_TABLES, PHASES } from "./config.js";
import {
  aiQuality,
  alerts,
  allTableHealth,
  dataQuality,
  overview,
  phaseStatuses,
  runHistory,
  tableRecords,
  type Queryable,
} from "./queries.js";

/**
 * DIP Engine observability API (Phase-agnostic monitoring).
 * Read-only, config-driven. Backs the /monitoring operations dashboard.
 */
export async function monitoringRoutes(app: FastifyInstance): Promise<void> {
  const db = () => app.pgPool as unknown as Queryable;

  app.get("/monitoring/overview", async () => overview(db()));
  app.get("/monitoring/phases", async () => ({ phases: await phaseStatuses(db()) }));
  app.get("/monitoring/tables", async () => ({ tables: await allTableHealth(db()) }));
  app.get("/monitoring/data-quality", async () => dataQuality(db()));
  app.get("/monitoring/ai-quality", async () => aiQuality(db()));
  app.get("/monitoring/alerts", async () => ({ alerts: await alerts(db()) }));

  app.get<{ Querystring: { limit?: string } }>("/monitoring/runs", async (request, reply) => {
    const limit = Number.parseInt(request.query.limit ?? "50", 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return reply.status(400).send({ error: "limit must be 1..200" });
    }
    return { runs: await runHistory(db(), limit) };
  });

  app.get<{ Params: { name: string }; Querystring: { mode?: string; limit?: string } }>(
    "/monitoring/tables/:name/records",
    async (request, reply) => {
      const { name } = request.params;
      if (!CORE_TABLES.some((t) => t.table === name)) {
        return reply.status(404).send({ error: `unknown or non-monitored table '${name}'` });
      }
      const mode = request.query.mode === "suspicious" ? "suspicious" : "latest";
      const limit = Number.parseInt(request.query.limit ?? "25", 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return reply.status(400).send({ error: "limit must be 1..100" });
      }
      return tableRecords(db(), name, mode, limit);
    },
  );

  // Expose the config so the UI can render selectors without hardcoding.
  app.get("/monitoring/config", async () => ({
    tables: CORE_TABLES.map((t) => ({ table: t.table, label: t.label, layer: t.layer, core: Boolean(t.core) })),
    phases: PHASES.map((p) => ({ id: p.id, key: p.key, name: p.name })),
  }));
}
