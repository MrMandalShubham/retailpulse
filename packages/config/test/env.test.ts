import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/env.js";

describe("loadConfig", () => {
  it("parses a valid environment with defaults applied", () => {
    const config = loadConfig({ DATABASE_URL: "postgres://dip:dip@localhost:5432/dip_engine" });
    expect(config.DATABASE_URL).toContain("dip_engine");
    expect(config.NODE_ENV).toBe("development");
    expect(config.API_PORT).toBe(3000);
  });

  it("rejects an environment without DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("rejects an invalid NODE_ENV", () => {
    expect(() =>
      loadConfig({ DATABASE_URL: "postgres://x", NODE_ENV: "staging" }),
    ).toThrow(/Invalid environment configuration/);
  });
});
