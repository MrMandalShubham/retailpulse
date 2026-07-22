const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|msclkid$|mc_cid$|mc_eid$|ref$)/i;

/**
 * Canonical URL normalization: lowercase scheme+host, drop default ports and
 * fragments, strip tracking params, sort remaining query params, trim trailing
 * slash (except root). The SAME page always normalizes to the SAME string —
 * used as the discovery map's dedup key (discovered_product_pages.normalized_url).
 */
export function normalizeSourceUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl.trim());
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if (
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")
    ) {
      url.port = "";
    }
    url.hash = "";

    const kept = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAMS.test(key))
      .sort(([a], [b]) => a.localeCompare(b));
    url.search = "";
    for (const [key, value] of kept) {
      url.searchParams.append(key, value);
    }

    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}
