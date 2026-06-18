import { describe, expect, it } from "vitest";
import type { EffectiveModel } from "@/lib/api";
import {
  eligibleExecutableModels,
  isAnthropicNativeModelId,
} from "./executable-model";

describe("isAnthropicNativeModelId", () => {
  it("accepts versioned Anthropic claude models", () => {
    expect(isAnthropicNativeModelId("anthropic/claude-opus-4.7")).toBe(true);
    expect(isAnthropicNativeModelId("anthropic/claude-sonnet-4.5")).toBe(true);
    expect(isAnthropicNativeModelId("claude-haiku-4-5")).toBe(true);
  });

  it("rejects -fast, bare-family, opus-4.6 and non-Anthropic ids", () => {
    expect(isAnthropicNativeModelId("anthropic/claude-opus-4.6-fast")).toBe(
      false,
    );
    expect(isAnthropicNativeModelId("anthropic/claude-opus-4")).toBe(false);
    expect(isAnthropicNativeModelId("anthropic/claude-opus-4.6")).toBe(false);
    expect(isAnthropicNativeModelId("openai/gpt-4o")).toBe(false);
    expect(isAnthropicNativeModelId("google/gemini-2.0")).toBe(false);
  });
});

describe("eligibleExecutableModels", () => {
  const model = (over: Partial<EffectiveModel>): EffectiveModel => ({
    id: "anthropic/claude-opus-4.7",
    name: "Opus",
    source: "byok",
    routing: "byok",
    ...over,
  });

  it("keeps only Anthropic-native models on a BYOK key", () => {
    const eligible = eligibleExecutableModels([
      model({ id: "anthropic/claude-opus-4.7", routing: "byok" }),
      // Right model, wrong routing (would fall back to OpenRouter).
      model({ id: "anthropic/claude-sonnet-4.5", routing: "workenai" }),
      // BYOK but not Anthropic-native.
      model({ id: "openai/gpt-4o", routing: "byok" }),
    ]);
    expect(eligible.map((m) => m.id)).toEqual(["anthropic/claude-opus-4.7"]);
  });
});
