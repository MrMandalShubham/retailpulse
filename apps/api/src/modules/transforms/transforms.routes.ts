import type { FastifyInstance } from "fastify";
import {
  OBSERVATION_STATUSES,
  OBSERVATION_TYPES,
  VALIDATION_STATUSES,
  type ObservationStatus,
  type ObservationType,
  type ValidationStatus,
} from "@dip/domain";
import { and, asc, count, desc, eq, schema } from "@dip/db";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read-only Phase 3 operator visibility into the staging/transform layer.
 * Not a business dashboard — internal monitoring only.
 */
export async function transformsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { limit?: string } }>("/transforms/runs", async (request, reply) => {
    const limit = parseLimit(request.query.limit);
    if (limit === null) return badRequest(reply, "limit must be an integer between 1 and 100");
    const runs = await app.db
      .select()
      .from(schema.transformRuns)
      .orderBy(desc(schema.transformRuns.createdAt))
      .limit(limit);
    return { runs };
  });

  app.get<{ Params: { id: string } }>("/transforms/runs/:id", async (request, reply) => {
    const { id } = request.params;
    if (!UUID_PATTERN.test(id)) return badRequest(reply, "run id must be a UUID");
    const [run] = await app.db
      .select()
      .from(schema.transformRuns)
      .where(eq(schema.transformRuns.id, id))
      .limit(1);
    if (!run) return reply.status(404).send({ error: "transform run not found" });

    const [[stagedCount], [observationCount]] = await Promise.all([
      app.db
        .select({ n: count() })
        .from(schema.stagedProducts)
        .where(eq(schema.stagedProducts.transformRunId, id)),
      app.db
        .select({ n: count() })
        .from(schema.transformObservations)
        .where(eq(schema.transformObservations.transformRunId, id)),
    ]);
    return {
      run,
      stagedProductCount: Number(stagedCount?.n ?? 0),
      observationCount: Number(observationCount?.n ?? 0),
    };
  });

  app.get<{
    Querystring: {
      validationStatus?: string;
      sourceId?: string;
      aiRecommended?: string;
      limit?: string;
    };
  }>("/transforms/staged-products", async (request, reply) => {
    const limit = parseLimit(request.query.limit);
    if (limit === null) return badRequest(reply, "limit must be an integer between 1 and 100");

    const { validationStatus, sourceId, aiRecommended } = request.query;
    if (
      validationStatus !== undefined &&
      !VALIDATION_STATUSES.includes(validationStatus as ValidationStatus)
    ) {
      return badRequest(reply, `validationStatus must be one of: ${VALIDATION_STATUSES.join(", ")}`);
    }
    if (sourceId !== undefined && !UUID_PATTERN.test(sourceId)) {
      return badRequest(reply, "sourceId must be a UUID");
    }
    if (aiRecommended !== undefined && aiRecommended !== "true" && aiRecommended !== "false") {
      return badRequest(reply, "aiRecommended must be 'true' or 'false'");
    }

    const conditions = [];
    if (validationStatus) {
      conditions.push(eq(schema.stagedProducts.validationStatus, validationStatus));
    }
    if (sourceId) conditions.push(eq(schema.stagedProducts.sourceId, sourceId));
    if (aiRecommended !== undefined) {
      conditions.push(eq(schema.stagedProducts.aiRecommended, aiRecommended === "true"));
    }

    const stagedProducts = await app.db
      .select()
      .from(schema.stagedProducts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.stagedProducts.createdAt))
      .limit(limit);
    return { stagedProducts };
  });

  app.get<{ Params: { id: string } }>("/transforms/staged-products/:id", async (request, reply) => {
    const { id } = request.params;
    if (!UUID_PATTERN.test(id)) return badRequest(reply, "staged product id must be a UUID");
    const [stagedProduct] = await app.db
      .select()
      .from(schema.stagedProducts)
      .where(eq(schema.stagedProducts.id, id))
      .limit(1);
    if (!stagedProduct) return reply.status(404).send({ error: "staged product not found" });

    const observations = await app.db
      .select()
      .from(schema.transformObservations)
      .where(eq(schema.transformObservations.stagedProductId, id))
      .orderBy(asc(schema.transformObservations.createdAt));
    return { stagedProduct, observations };
  });

  app.get<{ Querystring: { status?: string; type?: string; limit?: string } }>(
    "/transforms/observations",
    async (request, reply) => {
      const limit = parseLimit(request.query.limit);
      if (limit === null) return badRequest(reply, "limit must be an integer between 1 and 100");

      const { status, type } = request.query;
      if (status !== undefined && !OBSERVATION_STATUSES.includes(status as ObservationStatus)) {
        return badRequest(reply, `status must be one of: ${OBSERVATION_STATUSES.join(", ")}`);
      }
      if (type !== undefined && !OBSERVATION_TYPES.includes(type as ObservationType)) {
        return badRequest(reply, `type must be one of: ${OBSERVATION_TYPES.join(", ")}`);
      }

      const conditions = [];
      if (status) conditions.push(eq(schema.transformObservations.status, status));
      if (type) conditions.push(eq(schema.transformObservations.observationType, type));

      const observations = await app.db
        .select()
        .from(schema.transformObservations)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schema.transformObservations.createdAt))
        .limit(limit);
      return { observations };
    },
  );

  app.get("/transforms/rules", async () => {
    const rules = await app.db
      .select()
      .from(schema.normalizationRules)
      .orderBy(
        asc(schema.normalizationRules.ruleType),
        asc(schema.normalizationRules.sourceScope),
        asc(schema.normalizationRules.priority),
      );
    return { rules };
  });
}

function parseLimit(raw: string | undefined): number | null {
  const limit = Number.parseInt(raw ?? "20", 10);
  return Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : null;
}

function badRequest(reply: { status(code: number): { send(body: unknown): unknown } }, error: string) {
  return reply.status(400).send({ error });
}
