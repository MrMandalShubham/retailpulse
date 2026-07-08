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
    ENRICH_MAX_PRODUCTS: 500,
  };
}

describe("facts/markets/insights routes — validation (no database needed)", () => {
  it("rejects bad uuids, limits, and dates before touching the DB", async () => {
    const app = buildServer(makeConfig("postgres://unused:unused@localhost:5432/unused"));

    expect((await app.inject({ method: "GET", url: "/facts/prices?limit=0" })).statusCode).toBe(
      400,
    );
    expect(
      (await app.inject({ method: "GET", url: "/facts/prices?productId=nope" })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: "/facts/prices?from=not-a-date" })).statusCode,
    ).toBe(400);
    expect((await app.inject({ method: "GET", url: "/facts/prices/not-a-uuid" })).statusCode).toBe(
      400,
    );
    expect(
      (await app.inject({ method: "GET", url: "/facts/ratings?marketId=xyz" })).statusCode,
    ).toBe(400);
    expect((await app.inject({ method: "GET", url: "/markets/not-a-uuid" })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: "/sources/not-a-uuid/health" })).statusCode,
    ).toBe(400);

    await app.close();
  });
});

describe.skipIf(!testDbUrl)(
  "facts/markets/insights routes — integration (TEST_DATABASE_URL)",
  () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = buildServer(makeConfig(testDbUrl as string));
      await app.ready();
    });

    afterAll(() => app.close());

    it("lists price facts with filters", async () => {
      const res = await app.inject({ method: "GET", url: "/facts/prices?limit=10" });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().facts)).toBe(true);
    });

    it("lists markets and flags XG with its non-country note", async () => {
      const res = await app.inject({ method: "GET", url: "/markets" });
      expect(res.statusCode).toBe(200);
      const xg = res.json().markets.find((m: { code: string }) => m.code === "XG");
      if (xg) {
        expect(xg.note).toContain("NOT a country");
      }
    });

    it("serves freshness and coverage stats", async () => {
      const fresh = await app.inject({ method: "GET", url: "/freshness/stats" });
      expect(fresh.statusCode).toBe(200);
      expect(fresh.json().staleThresholdDays).toBe(30);
      expect(fresh.json().price).toHaveProperty("productsWithFacts");

      const coverage = await app.inject({ method: "GET", url: "/coverage/stats" });
      expect(coverage.statusCode).toBe(200);
      expect(coverage.json().productCoverage).toHaveProperty("priceCoveragePct");
      expect(Array.isArray(coverage.json().unmappedSources)).toBe(true);
    });

    it("404s for unknown markets and sources", async () => {
      const unknownId = "00000000-0000-4000-8000-000000000000";
      expect((await app.inject({ method: "GET", url: `/markets/${unknownId}` })).statusCode).toBe(
        404,
      );
      expect(
        (await app.inject({ method: "GET", url: `/sources/${unknownId}/health` })).statusCode,
      ).toBe(404);
    });
  },
);
