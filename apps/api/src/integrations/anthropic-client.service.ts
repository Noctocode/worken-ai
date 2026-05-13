import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatStreamEvent,
  StreamOptions,
} from '../chat/chat.service.js';

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

  /**
   * Streaming variant of `sendMessage` mapped onto the transport-
   * neutral `ChatStreamEvent` union owned by `chat.service`. Same
   * shape adjustments as the non-stream call: `system` lifted to
   * top-level, leading non-user messages dropped defensively.
   *
   * Anthropic event mapping:
   *   - `content_block_delta` with `text_delta` → ChatStreamEvent.content
   *   - `message_delta` carries the final `usage` totals when the
   *     stream concludes (`stop_reason` set on the same event) →
   *     ChatStreamEvent.usage. Anthropic doesn't return cost, so the
   *     controller backfills via the OpenRouter catalog estimator.
   *   - everything else (message_start, message_stop, ping, content_
   *     block_start/stop) is no-op for our purposes.
   *
   * Extended thinking is not yet surfaced — would map to a separate
   * `reasoning` event once the FE adds a thinking pane.
   */
  async *sendMessageStream(
    messages: ChatMessage[],
    model: string,
    apiKey: string,
    context?: string,
    options: StreamOptions = {},
    maxTokens: number = DEFAULT_MAX_TOKENS,
  ): AsyncIterable<ChatStreamEvent> {
    if (!apiKey) {
      yield {
        type: 'error',
        message: 'Anthropic API key is required for native routing',
      };
      return;
    }

    const client = new Anthropic({ apiKey });
    const nativeModel = toAnthropicModelId(model);

    const systemPiece = context ?? null;
    const filteredMessages = [...messages];
    while (
      filteredMessages.length > 0 &&
      filteredMessages[0].role !== 'user'
    ) {
      filteredMessages.shift();
    }

    let stream;
    try {
      stream = client.messages.stream(
        {
          model: nativeModel,
          max_tokens: maxTokens,
          ...(systemPiece ? { system: systemPiece } : {}),
          messages: filteredMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        },
        { signal: options.signal },
      );
    } catch (err) {
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        status:
          err && typeof err === 'object' && 'status' in err
            ? (err as { status?: number }).status
            : undefined,
      };
      return;
    }

    // Track running totals so we can emit a single `usage` event at
    // the end. Anthropic streams send input_tokens once (with
    // message_start) and incrementally bump output_tokens on
    // message_delta — we sum them once at stream close.
    let inputTokens: number | undefined;
    let outputTokens = 0;

    try {
      for await (const event of stream) {
        if (
          event.type === 'message_start' &&
          event.message.usage?.input_tokens != null
        ) {
          inputTokens = event.message.usage.input_tokens;
        }
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'content', delta: event.delta.text };
        }
        if (event.type === 'message_delta' && event.usage?.output_tokens) {
          // message_delta usage is cumulative on Anthropic's side —
          // overwrite rather than sum.
          outputTokens = event.usage.output_tokens;
        }
      }
    } catch (err) {
      // Same abort handling as the openai-sdk path in chat.service:
      // user-initiated Stop arrives as AbortError once the signal
      // fires. Return cleanly so the controller persists whatever
      // was buffered with metadata.partial = true.
      if (
        options.signal?.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        return;
      }
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        status:
          err && typeof err === 'object' && 'status' in err
            ? (err as { status?: number }).status
            : undefined,
      };
      return;
    }

    // One usage event at the very end. OpenRouter parity: the caller
    // gets totals exactly once per stream after content events.
    yield {
      type: 'usage',
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens:
        inputTokens != null ? inputTokens + outputTokens : outputTokens,
    };
  }
}
