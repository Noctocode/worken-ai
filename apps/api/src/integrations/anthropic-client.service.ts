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
 * Cap on web searches per turn. Anthropic bills $10/1000 searches, so a
 * bound keeps a single chat turn from running away on a vague query.
 * Simple factual lookups use 1–3; comparative research can use more.
 */
const WEB_SEARCH_MAX_USES = 5;

/**
 * Safety bound on `pause_turn` continuations. The server-side web_search
 * loop pauses (`stop_reason: 'pause_turn'`) when it hits its internal
 * iteration limit; we resume by re-sending the assistant turn. Capped so
 * a pathological loop can't spin forever.
 */
const MAX_PAUSE_CONTINUATIONS = 5;

/**
 * Basic web search tool — no code-execution dependency (the `_20260209+`
 * dynamic-filtering variants require the code execution tool to be
 * enabled). Works on every model that routes to Anthropic native, with
 * native citations. The owner's Anthropic org must have web search
 * enabled in the Console (Settings → Privacy); otherwise the API returns
 * an error, surfaced as a stream `error` event.
 */
const WEB_SEARCH_TOOL: Anthropic.Messages.WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: WEB_SEARCH_MAX_USES,
};

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
   *   - text blocks carry web-search `citations`, collected from the
   *     final message and emitted once as ChatStreamEvent.citations
   *     (OpenRouter parity).
   *   - final `usage` totals → ChatStreamEvent.usage. Anthropic doesn't
   *     return cost, so the controller backfills via the catalog
   *     estimator; `web_search_requests` rides along so the caller adds
   *     the per-search surcharge.
   *   - everything else (message_start, message_stop, ping, content_
   *     block_start/stop) is no-op for our purposes.
   *
   * Web search (`options.webSearch`): injects Anthropic's native
   * server-side `web_search` tool. The server runs the searches inside
   * its own loop; when that loop hits its iteration limit it pauses
   * (`stop_reason: 'pause_turn'`) and we resume by appending the
   * assistant turn and re-streaming, up to MAX_PAUSE_CONTINUATIONS.
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

    // Conversation grows only across `pause_turn` continuations — each
    // resume appends the assistant turn produced so far so the server can
    // pick up where its web-search loop left off.
    const convo: Anthropic.MessageParam[] = filteredMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Running totals emitted once at the end. Each `pause_turn` resume is
    // a separately-billed request, so input/output tokens and search
    // counts are summed across iterations (a no-op for the common
    // single-pass case).
    let inputTokens = 0;
    let outputTokens = 0;
    let webSearchRequests = 0;
    // Citations dedup by URL — the same source can be cited by multiple
    // text spans (and across pause_turn resumes).
    const citationsByUrl = new Map<string, { url: string; title?: string }>();

    for (let pass = 0; pass <= MAX_PAUSE_CONTINUATIONS; pass++) {
      let stream: MessageStream;
      try {
        stream = client.messages.stream(
          {
            model: nativeModel,
            max_tokens: maxTokens,
            ...(systemPiece ? { system: systemPiece } : {}),
            ...(options.webSearch ? { tools: [WEB_SEARCH_TOOL] } : {}),
            messages: convo,
          },
          { signal: options.signal },
        );
      } catch (err) {
        yield this.toErrorEvent(err);
        return;
      }

      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            yield { type: 'content', delta: event.delta.text };
          }
        }
      } catch (err) {
        // Same abort handling as the openai-sdk path in chat.service:
        // user-initiated Stop arrives as AbortError once the signal
        // fires. Return cleanly so the controller persists whatever was
        // buffered with metadata.partial = true.
        if (
          options.signal?.aborted ||
          (err instanceof Error && err.name === 'AbortError')
        ) {
          return;
        }
        yield this.toErrorEvent(err);
        return;
      }

      const final = await stream.finalMessage();
      inputTokens += final.usage.input_tokens ?? 0;
      outputTokens += final.usage.output_tokens ?? 0;
      webSearchRequests +=
        final.usage.server_tool_use?.web_search_requests ?? 0;

      for (const block of final.content) {
        if (block.type !== 'text' || !block.citations) continue;
        for (const c of block.citations) {
          if (c.type !== 'web_search_result_location') continue;
          if (!citationsByUrl.has(c.url)) {
            citationsByUrl.set(c.url, {
              url: c.url,
              ...(c.title ? { title: c.title } : {}),
            });
          }
        }
      }

      // `pause_turn` means the server-side loop wants to continue — append
      // the assistant turn and re-stream. Any other stop reason is final.
      if (final.stop_reason === 'pause_turn') {
        convo.push({
          role: 'assistant',
          // Response content blocks are accepted back as request params;
          // the SDK's param/response types diverge only nominally here.
          content: final.content as unknown as Anthropic.ContentBlockParam[],
        });
        continue;
      }
      break;
    }

    if (citationsByUrl.size > 0) {
      yield { type: 'citations', citations: [...citationsByUrl.values()] };
    }

    // One usage event at the very end. OpenRouter parity: the caller gets
    // totals exactly once per stream after content events.
    yield {
      type: 'usage',
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
      ...(webSearchRequests > 0 ? { webSearchRequests } : {}),
    };
  }

  /** Map an upstream throw to a stream `error` event (status when present). */
  private toErrorEvent(err: unknown): ChatStreamEvent {
    return {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      status:
        err && typeof err === 'object' && 'status' in err
          ? (err as { status?: number }).status
          : undefined,
    };
  }
}
