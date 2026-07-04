/** Collapse whitespace and trim; returns null for empty results. */
export function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Fold a string for matching: lowercase, strip punctuation/symbols to spaces,
 * collapse whitespace. "Dr. Jart+" and "dr jart" fold to the same key.
 */
export function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
