import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream';
import type { ChatStreamEvent, StreamOptions } from '../chat/chat.service.js';

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

/**
 * Whether an OpenRouter "anthropic/..." slug maps to a real model on
 * Anthropic's native Messages API. Caller may pass either the full
 * OpenRouter slug ("anthropic/claude-opus-4.6-fast") or the bare form
 * ("claude-opus-4.6-fast") — we normalize.
 *
 * Reason: OpenRouter carries some slugs that only exist on their own
 * routing infra:
 *   - `-fast` variants (Anthropic doesn't expose a -fast tier natively).
 *   - Bare family ids without minor version ("claude-opus-4") —
 *     Anthropic native ids always include the minor (4-7, 4-6, ...).
 *   - Opus 4.6 — Anthropic skipped this for Opus (only Sonnet 4.6
 *     exists natively, Opus jumped 4.5 → 4.7).
 *
 * Sending these to api.anthropic.com gets a 404. chat-transport uses
 * this predicate to decide whether to honour a BYOK Anthropic key for
 * a given slug or fall through to OpenRouter (where the slug still
 * works). models.service uses the same helper so the picker's
 * routing marker stays in sync with what chat-transport will actually
 * do.
 *
 * Add new blocked patterns here as we discover them — pure function,
 * easy to unit-test and audit.
 */
export function isAnthropicNativeSupported(modelId: string): boolean {
  const slash = modelId.indexOf('/');
  const bare = slash === -1 ? modelId : modelId.slice(slash + 1);
  const translated = toAnthropicModelId(bare);

  if (translated.endsWith('-fast')) return false;
  // Bare family without minor version (e.g. "claude-opus-4").
  if (/^claude-(opus|sonnet|haiku)-\d+$/.test(translated)) return false;
  // Opus 4.6 never landed on Anthropic native.
  if (translated.startsWith('claude-opus-4-6')) return false;
  return true;
}

// Mirror chat.service: cap the tool result fed back to the model so a large
// ARSO payload can't blow the context window.
const MAX_TOOL_RESULT_CHARS = 6000;

function toErrorEvent(err: unknown): ChatStreamEvent {
  return {
    type: 'error',
    message: err instanceof Error ? err.message : String(err),
    status:
      err && typeof err === 'object' && 'status' in err
        ? (err as { status?: number }).status
        : undefined,
  };
}

/** Short one-liner about a tool result for the UI / transcript. */
function summarizeToolResult(ok: boolean, result: unknown): string {
  if (!ok) {
    const msg =
      result && typeof result === 'object' && 'error' in result
        ? String((result as { error?: unknown }).error)
        : 'failed';
    return msg.slice(0, 160);
  }
  try {
    return JSON.stringify(result).slice(0, 160);
  } catch {
    return 'ok';
  }
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
    while (filteredMessages.length > 0 && filteredMessages[0].role !== 'user') {
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

    const filtered = [...messages];
    while (filtered.length > 0 && filtered[0].role !== 'user') {
      filtered.shift();
    }

    // Growing conversation we send Anthropic. Tool turns (the assistant's
    // tool_use content + a user message of tool_result blocks) get appended
    // between iterations, mirroring the openai-sdk loop in chat.service.
    const convo: Anthropic.MessageParam[] = filtered.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Native tool shape: Anthropic uses `input_schema`, not `parameters`.
    const tools =
      options.tools && options.tools.length > 0
        ? options.tools.map(
            (t): Anthropic.Tool => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters as Anthropic.Tool['input_schema'],
            }),
          )
        : undefined;
    const runTool = options.runTool;
    const maxIters = options.maxToolIters ?? 5;

    // Summed across tool-loop iterations, emitted once at the end.
    let inputTokens = 0;
    let outputTokens = 0;
    let iter = 0;

    while (true) {
      // Before each tool-loop re-call (not the first call): honor a mid-loop
      // Stop and re-check the spend budget so a tool loop can't run away.
      if (iter > 0) {
        if (options.signal?.aborted) return;
        try {
          await options.onBeforeToolIteration?.();
        } catch (err) {
          yield toErrorEvent(err);
          return;
        }
      }
      let stream: MessageStream;
      try {
        stream = client.messages.stream(
          {
            model: nativeModel,
            max_tokens: maxTokens,
            ...(systemPiece ? { system: systemPiece } : {}),
            messages: convo,
            ...(tools ? { tools } : {}),
          },
          { signal: options.signal },
        );
      } catch (err) {
        yield toErrorEvent(err);
        return;
      }

      let final: Anthropic.Message;
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            yield { type: 'content', delta: event.delta.text };
          }
        }
        // finalMessage assembles the full assistant turn (text + tool_use
        // blocks) and carries the authoritative usage totals.
        final = await stream.finalMessage();
        inputTokens += final.usage?.input_tokens ?? 0;
        outputTokens += final.usage?.output_tokens ?? 0;
      } catch (err) {
        // User-initiated Stop arrives as AbortError; return cleanly so the
        // controller persists the buffered content with metadata.partial.
        if (
          options.signal?.aborted ||
          (err instanceof Error && err.name === 'AbortError')
        ) {
          return;
        }
        yield toErrorEvent(err);
        return;
      }

      const toolUses = final.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      // Normal completion → done.
      if (!tools || !runTool || final.stop_reason !== 'tool_use') break;
      if (toolUses.length === 0) break;
      if (++iter >= maxIters) break;
      // Honor a Stop that arrived during streaming before spending on tools.
      if (options.signal?.aborted) return;

      // Append the assistant's tool_use turn verbatim, then run each tool and
      // append a user message of tool_result blocks for the next iteration.
      convo.push({
        role: 'assistant',
        content: final.content as Anthropic.ContentBlockParam[],
      });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const args = (tu.input ?? {}) as Record<string, unknown>;
        yield { type: 'tool_call', id: tu.id, name: tu.name, arguments: args };

        const t0 = Date.now();
        let ok = true;
        let result: unknown;
        try {
          result = await runTool(tu.name, args);
        } catch (err) {
          ok = false;
          result = { error: err instanceof Error ? err.message : String(err) };
        }
        yield {
          type: 'tool_result',
          id: tu.id,
          name: tu.name,
          ok,
          summary: summarizeToolResult(ok, result),
          latencyMs: Date.now() - t0,
        };
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result).slice(0, MAX_TOOL_RESULT_CHARS),
          ...(ok ? {} : { is_error: true }),
        });
      }
      convo.push({ role: 'user', content: toolResults });
    }

    yield {
      type: 'usage',
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    };
  }
}
