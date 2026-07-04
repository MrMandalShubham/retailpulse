import type {
  AIReviewDecision,
  AIReviewProvider,
  AiObservationReviewInput,
  AiRuleSuggestionInput,
  AiStagedProductReviewInput,
} from "@dip/domain";
import {
  buildObservationPayload,
  buildRuleSuggestionPayload,
  buildStagedProductPayload,
  DIP_REVIEW_SYSTEM_PROMPT,
  parseDecision,
} from "../prompt.js";

/**
 * Mistral adapter — plain fetch against the REST chat-completions API
 * (approved decision: no vendor SDK). JSON-object response mode, low
 * temperature, timeout + retry on 429/5xx/network errors.
 *
 * This file is the ONLY place in DIP Engine that knows Mistral's wire format.
 */

const PROVIDER_NAME = "mistral";
const DEFAULT_BASE_URL = "https://api.mistral.ai";

export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number | null,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

export interface MistralProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxRetries?: number;
  baseUrl?: string;
  /** Injectable for deterministic tests — defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface MistralResponse {
  id?: string;
  choices?: Array<{ message?: { content?: string } }>;
}

export function createMistralProvider(options: MistralProviderOptions): AIReviewProvider {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRetries = options.maxRetries ?? 2;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  async function complete(payload: Record<string, unknown>): Promise<AIReviewDecision> {
    let lastError: AIProviderError | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      }
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: options.model,
            temperature: 0.1,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: DIP_REVIEW_SYSTEM_PROMPT },
              { role: "user", content: JSON.stringify(payload) },
            ],
          }),
        });
      } catch (err) {
        lastError = new AIProviderError(
          `mistral request failed: ${err instanceof Error ? err.message : String(err)}`,
          null,
        );
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        lastError = new AIProviderError(
          `mistral returned HTTP ${response.status}`,
          response.status,
        );
        continue;
      }
      if (!response.ok) {
        const body = await safeText(response);
        throw new AIProviderError(
          `mistral returned HTTP ${response.status}: ${body.slice(0, 200)}`,
          response.status,
        );
      }

      const data = (await response.json()) as MistralResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new AIProviderError("mistral response contains no message content", null);
      }
      return parseDecision(content, {
        providerName: PROVIDER_NAME,
        modelName: options.model,
        traceId: data.id ?? null,
      });
    }
    throw lastError ?? new AIProviderError("mistral request failed after retries", null);
  }

  return {
    providerName: PROVIDER_NAME,
    modelName: options.model,
    reviewStagedProduct: (input: AiStagedProductReviewInput) =>
      complete(buildStagedProductPayload(input)),
    reviewObservation: (input: AiObservationReviewInput) =>
      complete(buildObservationPayload(input)),
    suggestRule: (input: AiRuleSuggestionInput) => complete(buildRuleSuggestionPayload(input)),
  };
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
