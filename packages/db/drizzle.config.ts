import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// The single .env lives at the repo root; drizzle-kit runs from packages/db.
loadEnv({ path: "../../.env" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://dip:dip@localhost:5432/dip_engine",
  },
  strict: true,
  verbose: true,
});
