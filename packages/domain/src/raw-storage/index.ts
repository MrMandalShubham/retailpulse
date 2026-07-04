/**
 * Raw storage domain — contracts for the raw layer (ELT "L" before "T").
 * Raw payloads (HTML/JSON snapshots, media) live in object storage; only
 * metadata/pointers live in the database. Raw-layer tables and the DO Spaces
 * adapter implementation arrive in Phase 2 — this module defines the boundary
 * so no other module ever touches raw payloads directly.
 */

/** Pointer to a raw document persisted in object storage. */
export interface RawDocumentRef {
  id: string;
  sourceId: string;
  url: string;
  contentType: string;
  /** Object-storage key (bucket path) of the stored payload. */
  storageKey: string;
  /** Content checksum used for change detection and dedup. */
  checksum: string;
  fetchedAt: string;
}

/** Boundary interface for the object-storage backend (DO Spaces in production). */
export interface RawStorageAdapter {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
}

// TODO(Phase 2): implemented by a DO Spaces (S3-compatible) adapter; raw_documents
// metadata table added to the database in the same phase.
