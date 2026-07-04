import type { AIReviewProvider } from "@dip/domain";
import { createMistralProvider } from "./providers/mistral.js";
import { createMockProvider } from "./providers/mock.js";

export interface ProviderFactoryConfig {
  provider: "mock" | "mistral";
  model: string;
  apiKey: string | null;
  timeoutMs: number;
  maxRetries: number;
}

/**
 * The single place a vendor is chosen. Adding a provider = one adapter file
 * plus one case here plus one AI_PROVIDER enum value — nothing else changes.
 */
export function createAIReviewProvider(config: ProviderFactoryConfig): AIReviewProvider {
  switch (config.provider) {
    case "mistral": {
      if (!config.apiKey) {
        throw new Error("mistral provider requires an API key");
      }
      return createMistralProvider({
        apiKey: config.apiKey,
        model: config.model,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
      });
    }
    case "mock":
      return createMockProvider();
  }
}
