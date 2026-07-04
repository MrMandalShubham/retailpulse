/**
 * Raw storage domain — boundary for the object-storage backend holding raw
 * payloads (ELT "L" before "T"). Raw payloads live in S3-compatible storage
 * (DigitalOcean Spaces in production, MinIO locally); only metadata/pointers
 * live in the database (see the ingestion domain's RawDocument).
 * No module other than the storage adapter ever touches raw payloads directly.
 */

/** Boundary interface for the object-storage backend. */
export interface RawStorageAdapter {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
}

// TODO(Phase 3+): listing/deletion/presigned URLs are added only when a
// concrete consumer needs them — deliberately minimal in Phase 2.
