/**
 * JA→EN translation via Mistral, for the @cosme Japan source. One batched chat
 * completion per product (all fields in a single JSON-in/JSON-out call), so 300
 * products ≈ 300 calls. Failures are non-fatal: a product that can't be
 * translated keeps its Japanese and leaves the English columns null rather than
 * being dropped.
 *
 * Two caching layers keep cost down: (1) an in-run memo so a brand/category
 * repeated across products is translated once; (2) a persistent cache in the
 * clean store (see cosme-pipeline) keyed by a source hash — we only call Mistral
 * when the source Japanese has changed since last ingest.
 */

const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface TranslatorDeps {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  logger?: { warn(o: unknown, m?: string): void };
}

export interface Translator {
  /** Translate a map of JA field values → EN. Missing/empty inputs pass through;
   *  on any error the input values are returned unchanged (never throws). */
  translate(fields: Record<string, string | null | undefined>): Promise<Record<string, string>>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function createMistralTranslator(deps: TranslatorDeps): Translator {
  const fetchImpl = (deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)) as FetchLike;
  const timeoutMs = deps.timeoutMs ?? 30_000;
  const memo = new Map<string, Record<string, string>>();

  return {
    async translate(fields) {
      // Keep only non-empty string inputs; others need no translation.
      const src: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (typeof v === "string" && v.trim().length > 0) src[k] = v.trim();
      }
      const keys = Object.keys(src);
      if (keys.length === 0) return {};

      const memoKey = JSON.stringify(src);
      const cached = memo.get(memoKey);
      if (cached) return cached;

      const prompt =
        "Translate these Japanese beauty-product fields to natural English. " +
        "Keep brand names in their common official/romanized English form. " +
        "Do not add words that are not in the source. " +
        "Return ONLY a JSON object with exactly these keys: " +
        keys.join(", ") +
        ".\n\n" +
        JSON.stringify(src, null, 2);

      try {
        const res = await fetchImpl(MISTRAL_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${deps.apiKey}`,
          },
          body: JSON.stringify({
            model: deps.model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
            response_format: { type: "json_object" },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          deps.logger?.warn({ status: res.status }, "translation call failed");
          return {};
        }
        const body = (await res.json()) as any;
        const content = body?.choices?.[0]?.message?.content;
        if (typeof content !== "string") return {};
        const parsed = JSON.parse(content) as Record<string, unknown>;
        const out: Record<string, string> = {};
        for (const k of keys) {
          const v = parsed[k];
          if (typeof v === "string" && v.trim().length > 0) out[k] = v.trim();
        }
        memo.set(memoKey, out);
        return out;
      } catch (err) {
        deps.logger?.warn(
          { error: err instanceof Error ? err.message : String(err) },
          "translation error",
        );
        return {};
      }
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
