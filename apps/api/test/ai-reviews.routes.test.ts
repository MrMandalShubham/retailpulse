import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "@dip/config";
import { and, eq, schema } from "@dip/db";
import { buildServer } from "../src/server.js";

const testDbUrl = process.env.TEST_DATABASE_URL;

function makeConfig(databaseUrl: string): AppConfig {
  return {
    NODE_ENV: "test",
    LOG_LEVEL: "error",
    API_PORT: 0,
    API_HOST: "127.0.0.1",
    DATABASE_URL: databaseUrl,
    DO_SPACES_FORCE_PATH_STYLE: false,
    INGEST_FETCH_TIMEOUT_MS: 15_000,
    TRANSFORM_MAX_DOCUMENTS: 100,
    AI_PROVIDER: "mock",
    AI_MODEL: "mistral-small-latest",
    AI_REVIEW_MAX_ITEMS: 20,
    AI_TIMEOUT_MS: 30_000,
    AI_MAX_RETRIES: 2,
    PROMOTION_MAX_ITEMS: 50,
  };
}

describe("ai-reviews routes — validation (no database needed)", () => {
  it("rejects bad limits, enums, and uuids before touching the DB", async () => {
    const app = buildServer(makeConfig("postgres://unused:unused@localhost:5432/unused"));

    expect(
      (await app.inject({ method: "GET", url: "/ai-reviews/runs?limit=999" })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: "/ai-reviews/runs/not-a-uuid" })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: "/ai-reviews/items?status=weird" })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: "/ai-reviews/rule-suggestions?status=maybe" }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/ai-reviews/rule-suggestions/not-a-uuid/approve",
        })
      ).statusCode,
    ).toBe(400);

    await app.close();
  });
});

describe.skipIf(!testDbUrl)("ai-reviews routes — integration (TEST_DATABASE_URL)", () => {
  let app: FastifyInstance;
  let runId: string;
  let itemId: string;
  const matchKey = `test-alias-${Date.now()}`;

  beforeAll(async () => {
    app = buildServer(makeConfig(testDbUrl as string));
    await app.ready();

    // Fixture chain: run -> item -> two identical suggestions (approve + 409 path).
    const [run] = await app.db
      .insert(schema.aiReviewRuns)
      .values({ providerName: "mock", modelName: "mock-reviewer-v1", status: "succeeded" })
      .returning({ id: schema.aiReviewRuns.id });
    runId = run!.id;
    const [item] = await app.db
      .insert(schema.aiReviewItems)
      .values({
        aiReviewRunId: runId,
        itemType: "observation",
        providerName: "mock",
        modelName: "mock-reviewer-v1",
        inputPayload: { task: "test" },
        status: "succeeded",
      })
      .returning({ id: schema.aiReviewItems.id });
    itemId = item!.id;
  });

  afterAll(async () => {
    // Run delete cascades to items and suggestions; the promoted rule is separate.
    await app.db.delete(schema.aiReviewRuns).where(eq(schema.aiReviewRuns.id, runId));
    await app.db
      .delete(schema.normalizationRules)
      .where(eq(schema.normalizationRules.matchKey, matchKey));
    await app.close();
  });

  async function insertSuggestion(): Promise<string> {
    const [suggestion] = await app.db
      .insert(schema.aiRuleSuggestions)
      .values({
        aiReviewItemId: itemId,
        ruleType: "brand_alias",
        sourceScope: "global",
        matchKey,
        normalizedValue: "Test Brand",
        confidenceScore: "0.900",
        status: "open",
      })
      .returning({ id: schema.aiRuleSuggestions.id });
    return suggestion!.id;
  }

  it("lists runs, items, and suggestions", async () => {
    expect((await app.inject({ method: "GET", url: "/ai-reviews/runs" })).statusCode).toBe(200);
    const detail = await app.inject({ method: "GET", url: `/ai-reviews/runs/${runId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().itemCounts.succeeded).toBeGreaterThanOrEqual(1);
    const items = await app.inject({ method: "GET", url: "/ai-reviews/items?provider=mock" });
    expect(items.statusCode).toBe(200);
    expect(items.json().items.length).toBeGreaterThanOrEqual(1);
  });

  it("approves an open suggestion into normalization_rules (learned_from_ai)", async () => {
    const suggestionId = await insertSuggestion();
    const res = await app.inject({
      method: "POST",
      url: `/ai-reviews/rule-suggestions/${suggestionId}/approve`,
    });
    expect(res.statusCode).toBe(200);
    const { ruleId } = res.json();

    const [rule] = await app.db
      .select()
      .from(schema.normalizationRules)
      .where(eq(schema.normalizationRules.id, ruleId));
    expect(rule?.learnedFromAi).toBe(true);
    expect(rule?.matchKey).toBe(matchKey);
    expect(rule?.notes).toContain(suggestionId);

    const [promoted] = await app.db
      .select({ status: schema.aiRuleSuggestions.status })
      .from(schema.aiRuleSuggestions)
      .where(eq(schema.aiRuleSuggestions.id, suggestionId));
    expect(promoted?.status).toBe("promoted");

    // Approving again -> 422 (no longer open).
    const again = await app.inject({
      method: "POST",
      url: `/ai-reviews/rule-suggestions/${suggestionId}/approve`,
    });
    expect(again.statusCode).toBe(422);
  });

  it("returns 409 when the identical rule already exists, and supports reject", async () => {
    const duplicateId = await insertSuggestion();
    const conflict = await app.inject({
      method: "POST",
      url: `/ai-reviews/rule-suggestions/${duplicateId}/approve`,
    });
    expect(conflict.statusCode).toBe(409);

    const reject = await app.inject({
      method: "POST",
      url: `/ai-reviews/rule-suggestions/${duplicateId}/reject`,
      payload: { notes: "duplicate of existing rule" },
    });
    expect(reject.statusCode).toBe(200);
    const [rejected] = await app.db
      .select({ status: schema.aiRuleSuggestions.status, notes: schema.aiRuleSuggestions.notes })
      .from(schema.aiRuleSuggestions)
      .where(
        and(
          eq(schema.aiRuleSuggestions.id, duplicateId),
          eq(schema.aiRuleSuggestions.status, "rejected"),
        ),
      );
    expect(rejected?.notes).toBe("duplicate of existing rule");
  });

  it("returns 404 for unknown suggestion ids", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/ai-reviews/rule-suggestions/00000000-0000-4000-8000-000000000000/approve",
    });
    expect(res.statusCode).toBe(404);
  });
});
