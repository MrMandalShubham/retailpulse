import { z } from "zod";

/**
 * Single source of truth for environment configuration.
 * Every process (API, worker, migrations) validates its environment
 * through this schema at boot and fails fast on misconfiguration.
 *
 * The DO_SPACES_* group is optional at the schema level because only the
 * ingestion worker needs object storage; processes that require it call
 * getSpacesConfig() and fail fast with a precise message.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Object storage (DigitalOcean Spaces in production, MinIO locally).
  DO_SPACES_ENDPOINT: z.string().min(1).optional(),
  DO_SPACES_REGION: z.string().min(1).optional(),
  DO_SPACES_BUCKET: z.string().min(1).optional(),
  DO_SPACES_KEY: z.string().min(1).optional(),
  DO_SPACES_SECRET: z.string().min(1).optional(),
  DO_SPACES_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  // Raw ingestion worker.
  INGEST_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  // Transform worker: per-run cap on raw documents processed.
  TRANSFORM_MAX_DOCUMENTS: z.coerce.number().int().positive().default(100),

  // AI review layer. Default 'mock' — no paid AI call can happen unless the
  // provider is explicitly configured (approved decision).
  AI_PROVIDER: z.enum(["mock", "mistral"]).default("mock"),
  AI_MODEL: z.string().min(1).default("mistral-small-latest"),
  MISTRAL_API_KEY: z.string().min(1).optional(),
  AI_REVIEW_MAX_ITEMS: z.coerce.number().int().positive().default(20),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).default(2),

  // Canonical promotion: per-batch cap on staged products considered.
  PROMOTION_MAX_ITEMS: z.coerce.number().int().positive().default(50),

  // Fact pipeline: per-run cap on evidence rows considered.
  FACTS_MAX_PRODUCTS: z.coerce.number().int().positive().default(500),
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

/** Fully-resolved object storage settings for processes that require them. */
export interface SpacesConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/**
 * Returns the object-storage settings or throws naming exactly which
 * DO_SPACES_* variables are missing.
 */
export function getSpacesConfig(config: AppConfig): SpacesConfig {
  const required = {
    DO_SPACES_ENDPOINT: config.DO_SPACES_ENDPOINT,
    DO_SPACES_REGION: config.DO_SPACES_REGION,
    DO_SPACES_BUCKET: config.DO_SPACES_BUCKET,
    DO_SPACES_KEY: config.DO_SPACES_KEY,
    DO_SPACES_SECRET: config.DO_SPACES_SECRET,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Object storage is not configured. Missing: ${missing.join(", ")}`);
  }
  return {
    endpoint: required.DO_SPACES_ENDPOINT as string,
    region: required.DO_SPACES_REGION as string,
    bucket: required.DO_SPACES_BUCKET as string,
    accessKeyId: required.DO_SPACES_KEY as string,
    secretAccessKey: required.DO_SPACES_SECRET as string,
    forcePathStyle: config.DO_SPACES_FORCE_PATH_STYLE,
  };
}

/** Fully-resolved AI review settings for processes that require them. */
export interface AiConfig {
  provider: "mock" | "mistral";
  model: string;
  /** null for providers that need no key (mock). */
  apiKey: string | null;
  maxItems: number;
  timeoutMs: number;
  maxRetries: number;
}

/**
 * Returns AI review settings, failing fast when the selected provider is
 * missing its credentials (e.g. AI_PROVIDER=mistral without MISTRAL_API_KEY).
 */
export function getAiConfig(config: AppConfig): AiConfig {
  if (config.AI_PROVIDER === "mistral" && !config.MISTRAL_API_KEY) {
    throw new Error("AI_PROVIDER is 'mistral' but MISTRAL_API_KEY is not set");
  }
  return {
    provider: config.AI_PROVIDER,
    model: config.AI_MODEL,
    apiKey: config.MISTRAL_API_KEY ?? null,
    maxItems: config.AI_REVIEW_MAX_ITEMS,
    timeoutMs: config.AI_TIMEOUT_MS,
    maxRetries: config.AI_MAX_RETRIES,
  };
}
