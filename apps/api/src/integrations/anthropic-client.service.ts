import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicChatResponse {
  content: string;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
}

const DEFAULT_MAX_TOKENS = 4096;

/**
 * Native Anthropic SDK wrapper. Used when a user has a BYOK key for the
 * "anthropic" provider — we bypass OpenRouter and call the Messages API
 * directly so the user pays Anthropic rather than the OpenRouter
 * markup.
 *
 * Anthropic's API differs from OpenAI's in two ways that matter here:
 *
 *   1. `system` is a top-level parameter, not a message with role
 *      "system". We extract it from the messages array before calling.
 *
 *   2. `max_tokens` is REQUIRED. OpenAI infers a sensible default
 *      server-side; Anthropic doesn't. We pass DEFAULT_MAX_TOKENS
 *      unless the caller overrides.
 *
 * Reasoning details are not modeled — Anthropic has its own
 * "extended thinking" feature with a different shape, which we'd
 * surface separately when/if FE adds support for it.
 */
/**
 * OpenRouter model ids dot-separate version components
 * ("claude-opus-4.7", "claude-sonnet-4.5"). Anthropic's native API
 * uses hyphens ("claude-opus-4-7"). Translate before sending; if a
 * future model breaks the convention we'll need a smarter map.
 */
function toAnthropicModelId(modelId: string): string {
  return modelId.replace(/\./g, '-');
}

@Injectable()
export class AnthropicClientService {
  async sendMessage(
    messages: ChatMessage[],
    model: string,
    apiKey: string,
    context?: string,
    maxTokens: number = DEFAULT_MAX_TOKENS,
  ): Promise<AnthropicChatResponse> {
    if (!apiKey) {
      throw new Error('Anthropic API key is required for native routing');
    }

    const client = new Anthropic({ apiKey });
    const nativeModel = toAnthropicModelId(model);

    // System content goes into Anthropic's dedicated `system` parameter,
    // not into the messages array. Our callers pass it as the `context`
    // arg; the messages array is always {user, assistant, …}.
    const systemPiece = context ?? null;

    // Anthropic requires the conversation to start with a "user" role
    // and alternate. Drop any leading non-user messages defensively
    // (in practice this only fires if a future caller passes a stale
    // assistant-led history fragment).
    const filteredMessages = [...messages];
    while (
      filteredMessages.length > 0 &&
      filteredMessages[0].role !== 'user'
    ) {
      filteredMessages.shift();
    }

    const response = await client.messages.create({
      model: nativeModel,
      max_tokens: maxTokens,
      ...(systemPiece ? { system: systemPiece } : {}),
      messages: filteredMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    // Concatenate any text content blocks. Tool use / images would live
    // alongside; we ignore them for now.
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;

    return {
      content: text,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    };
  }
}
