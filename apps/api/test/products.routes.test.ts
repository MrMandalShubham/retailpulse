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

describe("products & promotion routes — validation (no database needed)", () => {
  it("rejects bad limits, sorts, uuids, and missing required inputs", async () => {
    const app = buildServer(makeConfig("postgres://unused:unused@localhost:5432/unused"));

    expect((await app.inject({ method: "GET", url: "/products?limit=0" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/products?sort=wild" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/products?brandId=nope" })).statusCode).toBe(
      400,
    );
    expect((await app.inject({ method: "GET", url: "/products?minPrice=-4" })).statusCode).toBe(
      400,
    );
    expect((await app.inject({ method: "GET", url: "/products/search" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/products/not-a-uuid" })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: "/promotion/runs/not-a-uuid" })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: "POST", url: "/promotion/items/not-a-uuid/promote" })).statusCode,
    ).toBe(400);
    // Reject without a reason must fail — the operator note is mandatory.
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/promotion/items/00000000-0000-4000-8000-000000000000/reject",
          headers: { "content-type": "application/json" },
          payload: {},
        })
      ).statusCode,
    ).toBe(400);

    await app.close();
  });

  it("serves the operator dashboard shell", async () => {
    const app = buildServer(makeConfig("postgres://unused:unused@localhost:5432/unused"));
    const res = await app.inject({ method: "GET", url: "/dashboard" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("DIP Engine — Operator Dashboard");
    expect(res.body).toContain("/promotion/queue");
    await app.close();
  });
});

describe.skipIf(!testDbUrl)("products routes — integration (TEST_DATABASE_URL)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildServer(makeConfig(testDbUrl as string));
    await app.ready();
  });

  afterAll(() => app.close());

  it("lists products with pagination metadata", async () => {
    const res = await app.inject({ method: "GET", url: "/products?limit=5" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.total).toBe("number");
    expect(Array.isArray(body.products)).toBe(true);
  });

  it("searches with full-text query", async () => {
    const res = await app.inject({ method: "GET", url: "/products/search?q=essence" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().products)).toBe(true);
  });

  it("returns catalog stats", async () => {
    const res = await app.inject({ method: "GET", url: "/products/stats" });
    expect(res.statusCode).toBe(200);
    expect(res.json().totals.products).toBeGreaterThanOrEqual(0);
  });

  it("returns the promotion queue with eligibility flags", async () => {
    const res = await app.inject({ method: "GET", url: "/promotion/queue" });
    expect(res.statusCode).toBe(200);
    for (const entry of res.json().queue) {
      expect(typeof entry.eligible).toBe("boolean");
      expect(Array.isArray(entry.reasons)).toBe(true);
    }
  });

  it("404s for unknown products", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/products/00000000-0000-4000-8000-000000000000",
    });
    expect(res.statusCode).toBe(404);
  });
});
