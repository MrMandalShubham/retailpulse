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
    INGEST_FETCH_TIMEOUT_MS: 15_000,
  };
}

describe("ingestion routes — validation (no database needed)", () => {
  it("rejects an out-of-range limit and a malformed sourceId before touching the DB", async () => {
    const app = buildServer(makeConfig("postgres://unused:unused@localhost:5432/unused"));

    const badLimit = await app.inject({ method: "GET", url: "/ingestion/jobs?limit=abc" });
    expect(badLimit.statusCode).toBe(400);

    const badUuid = await app.inject({
      method: "GET",
      url: "/ingestion/jobs?sourceId=not-a-uuid",
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

  it("lists recent ingest runs", async () => {
    const res = await app.inject({ method: "GET", url: "/ingestion/jobs?limit=5" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().jobs)).toBe(true);
  });
});
