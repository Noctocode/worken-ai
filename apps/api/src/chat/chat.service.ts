import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { AnthropicClientService } from '../integrations/anthropic-client.service.js';
import type { ChatTransportKind } from '../integrations/chat-transport.service.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning_details?: unknown;
}

// OpenRouter returns a `cost` field on usage that the OpenAI types don't
// model; we read it through this loose shape.
interface OpenRouterUsage {
  cost?: number;
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

/**
 * Transport-neutral stream event shape. Both the OpenAI-compatible
 * path (OpenRouter / BYOK predefined providers) and the native
 * Anthropic SDK path map their own chunk shapes into this discriminated
 * union, so the SSE controller above only knows about one event model.
 *
 *  - `content` — visible token delta. Concatenates to the chat text.
 *  - `reasoning` — model "thinking" delta (OpenRouter reasoning_details
 *    or Anthropic extended-thinking). Not part of the persisted content;
 *    surfaced separately on the FE for the thinking pane.
 *  - `usage` — token + cost totals. OpenRouter emits this in the last
 *    chunk before [DONE]; Anthropic emits it on message_delta with
 *    `stop_reason`. Always exactly once per stream.
 *  - `error` — upstream provider error mid-stream (HTTP status + body).
 *    The controller maps this to an SSE `error` event so the FE
 *    humanizer can route it like a regular chat-errors case.
 */
export type ChatStreamEvent =
  | { type: 'content'; delta: string }
  | { type: 'reasoning'; delta: string }
  | {
      type: 'usage';
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      /** OpenRouter only; native BYOK paths leave it undefined and the
       *  caller backfills from the OpenRouter catalog. */
      costUsd?: number;
    }
  | { type: 'error'; message: string; status?: number };

export interface StreamOptions {
  /** Bound to the upstream SDK so a FE disconnect (or explicit Stop)
   *  aborts the underlying HTTP call instead of running it to
   *  completion and discarding the bytes. */
  signal?: AbortSignal;
}

@Injectable()
export class ChatService {
  constructor(private readonly anthropic: AnthropicClientService) {}

  private makeClient(baseURL: string, apiKey: string): OpenAI {
    return new OpenAI({
      baseURL,
      // OpenAI SDK rejects empty apiKey; pass a placeholder for endpoints
      // that don't need auth (rare — local Ollama, internal vLLM, …).
      apiKey: apiKey || 'no-auth',
      defaultHeaders: {
        'HTTP-Referer': process.env['SITE_URL'] || '',
        'X-Title': process.env['SITE_NAME'] || 'WorkenAI',
      },
    });
  }

  /**
   * Stream a chat completion as a sequence of transport-neutral
   * `ChatStreamEvent`s. Sole entry point now that the non-streaming
   * `sendMessage` has been removed — the SSE controller above wraps
   * these events into the wire SSE frames.
   *
   * Routing: Anthropic native SDK when `kind === 'anthropic-sdk'`,
   * OpenAI-compatible path otherwise. Both implementations forward
   * `signal` so a FE disconnect aborts the upstream call.
   */
  async *sendMessageStream(
    messages: ChatMessage[],
    model: string = 'moonshotai/kimi-k2.5',
    enableReasoning: boolean = true,
    context?: string,
    apiKey: string = '',
    baseURL: string = 'https://openrouter.ai/api/v1',
    kind: ChatTransportKind = 'openai-sdk',
    options: StreamOptions = {},
  ): AsyncIterable<ChatStreamEvent> {
    if (kind === 'anthropic-sdk') {
      // Delegate to the Anthropic adapter which speaks the native
      // event shape (content_block_delta, message_delta, …) and maps
      // each to our ChatStreamEvent union before yielding.
      yield* this.anthropic.sendMessageStream(
        messages.map((m) => ({ role: m.role, content: m.content })),
        model,
        apiKey,
        context,
        options,
      );
      return;
    }

    // OpenAI-compatible path (OpenRouter + BYOK predefined). The
    // `stream_options.include_usage: true` flag makes the provider
    // emit one extra chunk with usage totals AFTER the last content
    // chunk — without it, usage is null and we can't bill the call.
    const systemMessages: { role: 'system'; content: string }[] = [];
    if (context) {
      systemMessages.push({
        role: 'system',
        content:
          'Use the following project context to inform your answers. Reference this information when relevant.\n\n' +
          context,
      });
    }

    let stream;
    try {
      stream = await this.makeClient(baseURL, apiKey).chat.completions.create(
        {
          model,
          messages: [
            ...systemMessages,
            ...messages.map((msg) => ({
              role: msg.role,
              content: msg.content,
              ...(msg.reasoning_details
                ? { reasoning_details: msg.reasoning_details }
                : {}),
            })),
          ],
          stream: true,
          stream_options: { include_usage: true },
          ...(enableReasoning && { reasoning: { enabled: true } }),
        },
        { signal: options.signal },
      );
    } catch (err) {
      // Upstream rejection BEFORE the stream opens (auth, model-not-
      // found, etc.). Surface as a single error event and stop — the
      // SSE controller maps this to an `error` SSE event so the FE
      // humanizer can route it like a regular chat-errors case.
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

    try {
      for await (const chunk of stream) {
        // OpenRouter emits `reasoning` deltas through a non-standard
        // field on the delta object. The OpenAI types don't model it,
        // so we read through a loose shape and emit a separate event
        // type — FE shows reasoning in a "thinking" pane rather than
        // inlining it into the assistant text.
        const choice = chunk.choices?.[0];
        const delta = choice?.delta as
          | { content?: string; reasoning?: string }
          | undefined;
        if (delta?.reasoning) {
          yield { type: 'reasoning', delta: delta.reasoning };
        }
        if (delta?.content) {
          yield { type: 'content', delta: delta.content };
        }
        // The final-chunk-with-usage pattern: OpenAI/OpenRouter send a
        // chunk where choices is empty / finish_reason set and usage
        // is populated. Yield once, the controller stores it for the
        // observability log + final SSE `done` event.
        const usage = chunk.usage as OpenRouterUsage | undefined;
        if (usage && usage.total_tokens != null) {
          yield {
            type: 'usage',
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            costUsd: usage.cost,
          };
        }
      }
    } catch (err) {
      // Mid-stream error (e.g. provider terminated unexpectedly or
      // signal abort flipped to AbortError). AbortError is the
      // user-initiated Stop path — controller already persists the
      // partial assistant message; bubble as error so it's logged but
      // the FE doesn't render a generic "something went wrong" toast
      // on top of the partial bubble.
      const message = err instanceof Error ? err.message : String(err);
      yield {
        type: 'error',
        message,
        status:
          err && typeof err === 'object' && 'status' in err
            ? (err as { status?: number }).status
            : undefined,
      };
    }
  }
}
