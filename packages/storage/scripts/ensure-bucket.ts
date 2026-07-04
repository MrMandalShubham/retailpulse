/**
 * Local-dev helper: creates the raw-storage bucket if it does not exist.
 * Intended for the MinIO container from docker-compose; production Spaces
 * buckets are provisioned in DigitalOcean, not by this script.
 *
 * Runs outside the app runtime, so it reads env directly (same exception
 * as drizzle.config.ts).
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const { DO_SPACES_ENDPOINT, DO_SPACES_REGION, DO_SPACES_BUCKET, DO_SPACES_KEY, DO_SPACES_SECRET } =
  process.env;

if (
  !DO_SPACES_ENDPOINT ||
  !DO_SPACES_REGION ||
  !DO_SPACES_BUCKET ||
  !DO_SPACES_KEY ||
  !DO_SPACES_SECRET
) {
  console.error("Missing DO_SPACES_* variables in .env — see .env.example");
  process.exit(1);
}

const client = new S3Client({
  endpoint: DO_SPACES_ENDPOINT,
  region: DO_SPACES_REGION,
  credentials: { accessKeyId: DO_SPACES_KEY, secretAccessKey: DO_SPACES_SECRET },
  forcePathStyle: process.env.DO_SPACES_FORCE_PATH_STYLE === "true",
});

try {
  await client.send(new HeadBucketCommand({ Bucket: DO_SPACES_BUCKET }));
  console.log(`bucket '${DO_SPACES_BUCKET}' already exists`);
} catch {
  await client.send(new CreateBucketCommand({ Bucket: DO_SPACES_BUCKET }));
  console.log(`bucket '${DO_SPACES_BUCKET}' created`);
}
