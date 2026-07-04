import { describe, expect, it } from "vitest";
import { getSpacesConfig, loadConfig } from "../src/env.js";

const BASE_ENV = { DATABASE_URL: "postgres://dip:dip@localhost:5432/dip_engine" };

describe("loadConfig", () => {
  it("parses a valid environment with defaults applied", () => {
    const config = loadConfig(BASE_ENV);
    expect(config.DATABASE_URL).toContain("dip_engine");
    expect(config.NODE_ENV).toBe("development");
    expect(config.API_PORT).toBe(3000);
    expect(config.INGEST_FETCH_TIMEOUT_MS).toBe(15_000);
    expect(config.DO_SPACES_FORCE_PATH_STYLE).toBe(false);
  });

  it("rejects an environment without DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("rejects an invalid NODE_ENV", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgres://x", NODE_ENV: "staging" })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it("parses DO_SPACES_FORCE_PATH_STYLE as a boolean", () => {
    const config = loadConfig({ ...BASE_ENV, DO_SPACES_FORCE_PATH_STYLE: "true" });
    expect(config.DO_SPACES_FORCE_PATH_STYLE).toBe(true);
  });
});

describe("getSpacesConfig", () => {
  const SPACES_ENV = {
    ...BASE_ENV,
    DO_SPACES_ENDPOINT: "http://localhost:9000",
    DO_SPACES_REGION: "us-east-1",
    DO_SPACES_BUCKET: "dip-engine-raw",
    DO_SPACES_KEY: "key",
    DO_SPACES_SECRET: "secret",
    DO_SPACES_FORCE_PATH_STYLE: "true",
  };

  it("returns resolved settings when all variables are present", () => {
    const spaces = getSpacesConfig(loadConfig(SPACES_ENV));
    expect(spaces).toEqual({
      endpoint: "http://localhost:9000",
      region: "us-east-1",
      bucket: "dip-engine-raw",
      accessKeyId: "key",
      secretAccessKey: "secret",
      forcePathStyle: true,
    });
  });

  it("names exactly the missing variables", () => {
    const partial = { ...SPACES_ENV } as Record<string, string>;
    delete partial.DO_SPACES_BUCKET;
    delete partial.DO_SPACES_SECRET;
    expect(() => getSpacesConfig(loadConfig(partial))).toThrow(
      /Missing: DO_SPACES_BUCKET, DO_SPACES_SECRET/,
    );
  });
});
