import type { EffectiveModel } from "@/lib/api";

/**
 * FE mirror of the BE `isAnthropicNativeSupported` (anthropic-client.service):
 * whether a model id maps to a real model on Anthropic's native Messages API.
 * Executable skills only run on the Anthropic-native route, so the picker uses
 * this to show only runnable models. Keep in sync with the BE predicate.
 */
export function isAnthropicNativeModelId(modelId: string): boolean {
  const slash = modelId.indexOf("/");
  const provider = slash === -1 ? "" : modelId.slice(0, slash);
  const bare = slash === -1 ? modelId : modelId.slice(slash + 1);
  // Must be an Anthropic model in the first place.
  if (provider && provider !== "anthropic") return false;
  const translated = bare.replace(/\./g, "-");
  if (!translated.startsWith("claude-")) return false;
  // -fast variants only exist on OpenRouter's infra.
  if (translated.endsWith("-fast")) return false;
  // Bare family without a minor version (e.g. "claude-opus-4").
  if (/^claude-(opus|sonnet|haiku)-\d+$/.test(translated)) return false;
  // Opus 4.6 never landed on Anthropic native.
  if (translated.startsWith("claude-opus-4-6")) return false;
  return true;
}

/**
 * The effective models a user can actually run an executable skill on:
 * Anthropic-native AND routed via a BYOK Anthropic key (`routing === 'byok'`).
 * Without a BYOK key the model falls back to OpenRouter, which the BE rejects
 * for executable runs (it isn't the native Anthropic transport).
 */
export function eligibleExecutableModels(
  models: EffectiveModel[],
): EffectiveModel[] {
  return models.filter(
    (m) => m.routing === "byok" && isAnthropicNativeModelId(m.id),
  );
}
