import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "@dip/config";
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

describe("transforms routes — validation (no database needed)", () => {
  it("rejects bad limits, enums, and uuids before touching the DB", async () => {
    const app = buildServer(makeConfig("postgres://unused:unused@localhost:5432/unused"));

    const badLimit = await app.inject({ method: "GET", url: "/transforms/runs?limit=0" });
    expect(badLimit.statusCode).toBe(400);

    const badRunId = await app.inject({ method: "GET", url: "/transforms/runs/not-a-uuid" });
    expect(badRunId.statusCode).toBe(400);

    const badStatus = await app.inject({
      method: "GET",
      url: "/transforms/staged-products?validationStatus=bogus",
    });
    expect(badStatus.statusCode).toBe(400);
    expect(badStatus.json().error).toContain("validationStatus");

    const badAiFlag = await app.inject({
      method: "GET",
      url: "/transforms/staged-products?aiRecommended=maybe",
    });
    expect(badAiFlag.statusCode).toBe(400);

    const badType = await app.inject({
      method: "GET",
      url: "/transforms/observations?type=weird_thing",
    });
    expect(badType.statusCode).toBe(400);

    await app.close();
  });
});

describe.skipIf(!testDbUrl)("transforms routes — integration (TEST_DATABASE_URL)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildServer(makeConfig(testDbUrl as string));
    await app.ready();
  });

  afterAll(() => app.close());

  it("lists transform runs", async () => {
    const res = await app.inject({ method: "GET", url: "/transforms/runs" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().runs)).toBe(true);
  });

  it("filters staged products by validation status", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/transforms/staged-products?validationStatus=needs_review",
    });
    expect(res.statusCode).toBe(200);
    for (const staged of res.json().stagedProducts) {
      expect(staged.validationStatus).toBe("needs_review");
    }
  });

  it("filters observations by status and type", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/transforms/observations?status=open&type=unseen_pattern",
    });
    expect(res.statusCode).toBe(200);
    for (const observation of res.json().observations) {
      expect(observation.status).toBe("open");
      expect(observation.observationType).toBe("unseen_pattern");
    }
  });

  it("lists normalization rules including the starter seed", async () => {
    const res = await app.inject({ method: "GET", url: "/transforms/rules" });
    expect(res.statusCode).toBe(200);
    expect(res.json().rules.length).toBeGreaterThan(0);
  });

  it("returns 404 for an unknown run id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/transforms/runs/00000000-0000-4000-8000-000000000000",
    });
    expect(res.statusCode).toBe(404);
  });
});
