import { describe, expect, it } from "vitest";
import type { AppConfig } from "@dip/config";
import { buildServer } from "../src/server.js";

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

describe("monitoring routes — validation & static (no database needed)", () => {
  it("validates limits and unknown tables before touching the DB", async () => {
    const app = buildServer(makeConfig("postgres://unused:unused@localhost:5432/unused"));

    // runs limit out of range → 400 (validated before any query)
    expect((await app.inject({ method: "GET", url: "/monitoring/runs?limit=0" })).statusCode).toBe(
      400,
    );
    expect(
      (await app.inject({ method: "GET", url: "/monitoring/runs?limit=999" })).statusCode,
    ).toBe(400);

    // record inspector on a non-monitored table → 404 (config-checked, no DB)
    expect(
      (await app.inject({ method: "GET", url: "/monitoring/tables/not_a_real_table/records" }))
        .statusCode,
    ).toBe(404);
    // bad record limit on a known table → 400
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/monitoring/tables/products_master/records?limit=500",
        })
      ).statusCode,
    ).toBe(400);

    await app.close();
  });

  it("serves the config (no DB) and the observability console page", async () => {
    const app = buildServer(makeConfig("postgres://unused:unused@localhost:5432/unused"));

    const cfg = await app.inject({ method: "GET", url: "/monitoring/config" });
    expect(cfg.statusCode).toBe(200);
    const body = cfg.json();
    expect(Array.isArray(body.tables)).toBe(true);
    expect(body.tables.some((t: { table: string }) => t.table === "products_master")).toBe(true);
    // Phases: 0 (discovery) + 1..6.
    expect(body.phases).toHaveLength(7);
    expect(body.phases.some((p: { key: string }) => p.key === "discovery")).toBe(true);

    const page = await app.inject({ method: "GET", url: "/monitoring" });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain("Observability Console");

    await app.close();
  });
});
