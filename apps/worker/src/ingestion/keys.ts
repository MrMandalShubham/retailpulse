import { createHash } from "node:crypto";

/** sha256 hex of a payload — stored on raw_documents for change detection. */
export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Deterministic, predictable object-storage key for a raw payload:
 *   raw/{source_slug}/{yyyy-mm-dd}/{crawl_job_id}/{sha1(url)[0..16]}.{html|json}
 * Prefixing by source and date keeps the bucket browsable and matches the
 * blueprint's "predictable prefixes" storage rule.
 */
export function buildRawStorageKey(input: {
  sourceSlug: string;
  crawlJobId: string;
  url: string;
  contentType: string | null;
  fetchedAt: Date;
}): string {
  const day = input.fetchedAt.toISOString().slice(0, 10);
  const urlHash = createHash("sha1").update(input.url).digest("hex").slice(0, 16);
  const extension = input.contentType?.includes("json") ? "json" : "html";
  return `raw/${input.sourceSlug}/${day}/${input.crawlJobId}/${urlHash}.${extension}`;
}
