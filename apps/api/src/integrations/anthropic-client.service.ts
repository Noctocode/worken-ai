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

// ── Tool-calling agent loop (Option #3) ─────────────────────────────
// Provider-neutral-ish shapes; commit 7 lifts these into a transport
// abstraction. For the spike they live with the only implementation.

/** A tool the model may call. `inputSchema` is a JSON Schema object. */
export interface AgentToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Caller-supplied handler: runs a tool call, returns its result text.
 *  Throwing is surfaced to the model as an error tool_result. */
export type AgentToolDispatch = (call: {
  id: string;
  name: string;
  input: unknown;
}) => Promise<string>;

/** Events streamed by the agent loop. */
export type AgentLoopEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      id: string;
      name: string;
      output: string;
      isError: boolean;
    }
  | {
      type: 'usage';
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; message: string; status?: number };

export interface StreamWithToolsParams {
  model: string;
  apiKey: string;
  system?: string;
  messages: ChatMessage[];
  tools: AgentToolDef[];
  dispatch: AgentToolDispatch;
  /** Hard cap on model↔tool round-trips. Fail-closed on reaching it. */
  maxIterations?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_MAX_ITERATIONS = 8;

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
    const filteredMessages = [...messages];
    while (filteredMessages.length > 0 && filteredMessages[0].role !== 'user') {
      filteredMessages.shift();
    }

    let stream: MessageStream;
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

  /**
   * Agent loop with tool-calling (Option #3 spike). Runs
   * model → tool_use → dispatch → tool_result → repeat until the model
   * stops requesting tools or `maxIterations` is hit (fail-closed). Yields a
   * provider-neutral {@link AgentLoopEvent} stream; the caller
   * (SkillExecutionService) supplies `dispatch` to actually run each tool.
   *
   * Uses one `messages.create` per round (not token-level streaming within a
   * round) — enough to validate the loop; token streaming is a later refinement.
   * Honors an abort signal between/within rounds.
   */
  async *streamWithTools(
    params: StreamWithToolsParams,
  ): AsyncIterable<AgentLoopEvent> {
    const { model, apiKey, system, tools, dispatch, signal } = params;
    if (!apiKey) {
      yield { type: 'error', message: 'Anthropic API key is required' };
      return;
    }
    const client = new Anthropic({ apiKey });
    const nativeModel = toAnthropicModelId(model);
    const maxIterations = params.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;

    // Anthropic requires the conversation to open with a user turn.
    const seed = [...params.messages];
    while (seed.length > 0 && seed[0].role !== 'user') seed.shift();
    const msgs: Anthropic.MessageParam[] = seed.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    let promptTokens = 0;
    let completionTokens = 0;
    const emitUsage = (): AgentLoopEvent => ({
      type: 'usage',
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    });

    for (let iter = 0; iter < maxIterations; iter++) {
      if (signal?.aborted) {
        yield emitUsage();
        yield { type: 'done', stopReason: 'aborted' };
        return;
      }

      let resp: Anthropic.Message;
      try {
        resp = await client.messages.create(
          {
            model: nativeModel,
            max_tokens: maxTokens,
            ...(system ? { system } : {}),
            tools: anthropicTools,
            messages: msgs,
          },
          { signal },
        );
      } catch (err) {
        if (
          signal?.aborted ||
          (err instanceof Error && err.name === 'AbortError')
        ) {
          yield emitUsage();
          yield { type: 'done', stopReason: 'aborted' };
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

      promptTokens += resp.usage?.input_tokens ?? 0;
      completionTokens += resp.usage?.output_tokens ?? 0;

      for (const block of resp.content) {
        if (block.type === 'text') yield { type: 'text', delta: block.text };
      }

      const toolUses = resp.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) {
        yield emitUsage();
        yield { type: 'done', stopReason: resp.stop_reason ?? 'end_turn' };
        return;
      }

      // Echo the assistant turn (incl. tool_use blocks) back into history,
      // then answer every tool_use with a tool_result in one user turn.
      msgs.push({
        role: 'assistant',
        content: resp.content as Anthropic.ContentBlockParam[],
      });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        yield { type: 'tool_call', id: tu.id, name: tu.name, input: tu.input };
        let output: string;
        let isError = false;
        try {
          output = await dispatch({
            id: tu.id,
            name: tu.name,
            input: tu.input,
          });
        } catch (err) {
          output = err instanceof Error ? err.message : String(err);
          isError = true;
        }
        yield {
          type: 'tool_result',
          id: tu.id,
          name: tu.name,
          output,
          isError,
        };
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: output,
          ...(isError ? { is_error: true } : {}),
        });
      }
      msgs.push({ role: 'user', content: results });
    }

    // Iteration cap reached without a natural stop — fail closed.
    yield emitUsage();
    yield { type: 'done', stopReason: 'max_iterations' };
  }
}
