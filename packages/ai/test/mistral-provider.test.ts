/**
 * Mistral adapter tests with a stubbed fetch implementation — no network,
 * no API key spend (approved verification approach).
 */
import { describe, expect, it } from "vitest";
import { AIProviderError, createMistralProvider } from "../src/providers/mistral.js";

const VALID_CONTENT = JSON.stringify({
  decision_type: "resolved",
  confidence_score: 0.88,
  resolved_fields: { brand: "LANEIGE" },
  unresolved_fields: [],
  page_type_suggestion: null,
  suggested_rules: [],
  notes: null,
});

function mistralResponse(content: string, id = "req-123"): Response {
  return new Response(JSON.stringify({ id, choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const OBSERVATION_INPUT = {
  sourceSlug: "test-store",
  observationType: "unknown_brand" as const,
  fieldName: "brand",
  rawValue: "laneige",
  suggestedValue: null,
  notes: null,
};

describe("mistral provider (stubbed HTTP)", () => {
  it("sends the shared contract and parses a valid response", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const provider = createMistralProvider({
      apiKey: "test-key",
      model: "mistral-small-latest",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init: init as RequestInit });
        return mistralResponse(VALID_CONTENT);
      },
    });

    const decision = await provider.reviewObservation(OBSERVATION_INPUT);
    expect(decision.decisionType).toBe("resolved");
    expect(decision.resolvedFields.brand).toBe("LANEIGE");
    expect(decision.providerName).toBe("mistral");
    expect(decision.traceId).toBe("req-123");

    const request = requests[0];
    expect(request?.url).toBe("https://api.mistral.ai/v1/chat/completions");
    const headers = request?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(request?.init.body));
    expect(body.model).toBe("mistral-small-latest");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("NEVER invent facts");
    expect(JSON.parse(body.messages[1].content).task).toBe("review_observation");
  });

  it("retries on 429 and succeeds on the next attempt", async () => {
    let calls = 0;
    const provider = createMistralProvider({
      apiKey: "k",
      model: "m",
      maxRetries: 2,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return new Response("rate limited", { status: 429 });
        return mistralResponse(VALID_CONTENT);
      },
    });
    const decision = await provider.reviewObservation(OBSERVATION_INPUT);
    expect(calls).toBe(2);
    expect(decision.decisionType).toBe("resolved");
  });

  it("surfaces persistent 5xx as AIProviderError after exhausting retries", async () => {
    let calls = 0;
    const provider = createMistralProvider({
      apiKey: "k",
      model: "m",
      maxRetries: 1,
      fetchImpl: async () => {
        calls += 1;
        return new Response("boom", { status: 500 });
      },
    });
    await expect(provider.reviewObservation(OBSERVATION_INPUT)).rejects.toThrow(AIProviderError);
    expect(calls).toBe(2);
  });

  it("does not retry 4xx auth errors", async () => {
    let calls = 0;
    const provider = createMistralProvider({
      apiKey: "bad",
      model: "m",
      maxRetries: 2,
      fetchImpl: async () => {
        calls += 1;
        return new Response("unauthorized", { status: 401 });
      },
    });
    await expect(provider.reviewObservation(OBSERVATION_INPUT)).rejects.toThrow(/HTTP 401/);
    expect(calls).toBe(1);
  });

  it("fails cleanly when the model returns non-schema content", async () => {
    const provider = createMistralProvider({
      apiKey: "k",
      model: "m",
      fetchImpl: async () => mistralResponse("I think the brand is LANEIGE."),
    });
    await expect(provider.reviewObservation(OBSERVATION_INPUT)).rejects.toThrow(/not valid JSON/);
  });
});
