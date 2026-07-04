import { describe, expect, it } from "vitest";
import type { AppConfig } from "@dip/config";
import { buildServer } from "../src/server.js";

const testConfig: AppConfig = {
  NODE_ENV: "test",
  LOG_LEVEL: "error",
  API_PORT: 0,
  API_HOST: "127.0.0.1",
  // The pg pool connects lazily, so liveness tests need no running database.
  DATABASE_URL: "postgres://test:test@localhost:5432/dip_engine_test",
  DO_SPACES_FORCE_PATH_STYLE: false,
  INGEST_FETCH_TIMEOUT_MS: 15_000,
};

describe("health endpoints", () => {
  it("GET /health reports liveness without touching the database", async () => {
    const app = buildServer(testConfig);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", service: "dip-engine-api" });
    await app.close();
  });
});
