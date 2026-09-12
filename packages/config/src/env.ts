import { z } from "zod";

/**
 * Single source of truth for environment configuration.
 * Every process (API, worker, migrations) validates its environment
 * through this schema at boot and fails fast on misconfiguration.
 *
 * The storage-free 2-step engine (discover → ingest+clean) needs almost
 * nothing beyond the database URL and a fetch timeout.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Fetch timeout for discovery + ingestion HTTP calls.
  INGEST_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  // Translation (JA→EN at ingest for the @cosme Japan source). Optional: the
  // Olive Young flow needs none of these; the cosme flow requires MISTRAL_API_KEY.
  MISTRAL_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("mistral-small-latest"),
  AI_PROVIDER: z.string().default("mistral"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
