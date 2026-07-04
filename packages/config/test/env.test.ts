import { describe, expect, it } from "vitest";
import { getAiConfig, getSpacesConfig, loadConfig } from "../src/env.js";

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

describe("getAiConfig", () => {
  it("defaults to the mock provider with no key required", () => {
    const ai = getAiConfig(loadConfig(BASE_ENV));
    expect(ai).toEqual({
      provider: "mock",
      model: "mistral-small-latest",
      apiKey: null,
      maxItems: 20,
      timeoutMs: 30_000,
      maxRetries: 2,
    });
  });

  it("returns mistral settings when fully configured", () => {
    const ai = getAiConfig(
      loadConfig({
        ...BASE_ENV,
        AI_PROVIDER: "mistral",
        AI_MODEL: "mistral-large-latest",
        MISTRAL_API_KEY: "key-123",
        AI_REVIEW_MAX_ITEMS: "5",
      }),
    );
    expect(ai.provider).toBe("mistral");
    expect(ai.model).toBe("mistral-large-latest");
    expect(ai.apiKey).toBe("key-123");
    expect(ai.maxItems).toBe(5);
  });

  it("fails fast when mistral is selected without an API key", () => {
    expect(() => getAiConfig(loadConfig({ ...BASE_ENV, AI_PROVIDER: "mistral" }))).toThrow(
      /MISTRAL_API_KEY/,
    );
  });

  it("rejects unknown providers at the schema level", () => {
    expect(() => loadConfig({ ...BASE_ENV, AI_PROVIDER: "openai" })).toThrow(
      /Invalid environment configuration/,
    );
  });
});
