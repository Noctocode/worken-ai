/**
 * Map of provider id → native API endpoint metadata.
 *
 * Used by the chat resolver when a user has a BYOK key set for that
 * provider in `integrations`: instead of routing through OpenRouter we
 * point the OpenAI SDK at the native baseURL with the user's own key.
 *
 * `openAICompatible: false` means the provider's native API doesn't
 * speak the OpenAI Chat Completions wire format, so the OpenAI SDK
 * can't talk to it directly — for those, BYOK keys are stored but the
 * chat path keeps falling back to OpenRouter (with a logged hint).
 * Lifting that limitation needs either the provider's own SDK or
 * OpenRouter's "Bring Your Own Provider Key" registration flow.
 *
 * Provider ids must match `predefined-providers.ts` and
 * `observability_events.provider`.
 */
export interface NativeEndpoint {
  baseURL: string;
  openAICompatible: boolean;
}

export const NATIVE_ENDPOINTS: Record<string, NativeEndpoint> = {
  openai: {
    baseURL: "https://api.openai.com/v1",
    openAICompatible: true,
  },
  deepseek: {
    baseURL: "https://api.deepseek.com/v1",
    openAICompatible: true,
  },
  mistralai: {
    baseURL: "https://api.mistral.ai/v1",
    openAICompatible: true,
  },
  perplexity: {
    baseURL: "https://api.perplexity.ai",
    openAICompatible: true,
  },
  "x-ai": {
    baseURL: "https://api.x.ai/v1",
    openAICompatible: true,
  },
  github: {
    baseURL: "https://models.inference.ai.azure.com",
    openAICompatible: true,
  },
  // Stored but not honored as direct BYOK — non-OpenAI-compatible.
  // Falls through to OpenRouter routing.
  anthropic: {
    baseURL: "https://api.anthropic.com/v1",
    openAICompatible: false,
  },
  google: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    openAICompatible: false,
  },
  qwen: {
    baseURL: "https://dashscope.aliyuncs.com/api/v1",
    openAICompatible: false,
  },
};

/**
 * Extract the provider id from an OpenRouter-style model identifier.
 * "anthropic/claude-opus-4.7" → "anthropic"
 * "openai/gpt-5.5" → "openai"
 * Returns null when the identifier has no slash (e.g. a custom model id
 * that lives at a Custom LLM endpoint).
 */
export function providerOfModel(modelId: string): string | null {
  const idx = modelId.indexOf("/");
  if (idx === -1) return null;
  return modelId.slice(0, idx);
}
