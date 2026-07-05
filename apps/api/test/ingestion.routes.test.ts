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
    FACTS_MAX_PRODUCTS: 500,
  };
}

describe("ingestion routes — validation (no database needed)", () => {
  it("rejects an out-of-range limit and a malformed job id before touching the DB", async () => {
    const app = buildServer(makeConfig("postgres://unused:unused@localhost:5432/unused"));

    const badLimit = await app.inject({ method: "GET", url: "/ingestion/jobs?limit=abc" });
    expect(badLimit.statusCode).toBe(400);

    const badUuid = await app.inject({
      method: "GET",
      url: "/ingestion/jobs/not-a-uuid/raw-documents",
    });
    expect(badUuid.statusCode).toBe(400);

    await app.close();
  });
});

describe.skipIf(!testDbUrl)("ingestion routes — integration (TEST_DATABASE_URL)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildServer(makeConfig(testDbUrl as string));
    await app.ready();
  });

  afterAll(() => app.close());

  it("lists sources", async () => {
    const res = await app.inject({ method: "GET", url: "/ingestion/sources" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().sources)).toBe(true);
  });

  it("lists recent jobs with raw document counts", async () => {
    const res = await app.inject({ method: "GET", url: "/ingestion/jobs?limit=5" });
    expect(res.statusCode).toBe(200);
    const { jobs } = res.json();
    expect(Array.isArray(jobs)).toBe(true);
    for (const job of jobs) {
      expect(typeof job.rawDocumentCount).toBe("number");
    }
  });

  it("returns 404 for an unknown job id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/ingestion/jobs/00000000-0000-4000-8000-000000000000/raw-documents",
    });
    expect(res.statusCode).toBe(404);
  });
});
