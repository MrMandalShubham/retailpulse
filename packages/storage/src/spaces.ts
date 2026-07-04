import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { RawStorageAdapter } from "@dip/domain";

export interface SpacesStorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** true for MinIO-style local endpoints; false for DigitalOcean Spaces. */
  forcePathStyle?: boolean;
}

/**
 * S3-compatible implementation of the RawStorageAdapter boundary.
 * Points at DigitalOcean Spaces in production and MinIO locally — same env
 * contract, no code changes. Deliberately minimal: put/get/exists only.
 */
export function createSpacesStorage(options: SpacesStorageOptions): RawStorageAdapter {
  const client = new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    forcePathStyle: options.forcePathStyle ?? false,
  });
  const bucket = options.bucket;

  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },

    async get(key) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) {
        throw new Error(`Object '${key}' has no body`);
      }
      return response.Body.transformToByteArray();
    },

    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (err) {
        if (isNotFound(err)) return false;
        throw err;
      }
    },
  };
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === "NotFound" || candidate.$metadata?.httpStatusCode === 404;
}
