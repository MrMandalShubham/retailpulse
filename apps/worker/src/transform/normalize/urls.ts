const TRACKING_PARAMS = /^(utm_|fbclid|gclid|msclkid|mc_cid|mc_eid|ref$)/i;

/** Resolve a possibly-relative href against a base URL; null when invalid. */
export function absolutize(baseUrl: string, href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const resolved = new URL(href, baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

/** Strip tracking parameters and fragments; keep meaningful query params. */
export function stripTracking(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Normalize an image URL: absolutize, upgrade protocol-relative, strip tracking. */
export function normalizeImageUrl(
  baseUrl: string,
  src: string | null | undefined,
): string | null {
  if (!src) return null;
  const candidate = src.startsWith("//") ? `https:${src}` : src;
  const absolute = absolutize(baseUrl, candidate);
  return absolute ? stripTracking(absolute) : null;
}
