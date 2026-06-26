import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import type { ChatStreamEvent, StreamOptions } from '../chat/chat.service.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Output-token budget for the Responses web-search path. Must be generous:
 * reasoning models spend tokens on hidden reasoning BEFORE the answer, and a
 * too-low cap makes the response stop at `incomplete` with no visible text
 * while STILL billing the reasoning tokens. 16k leaves ample room for both.
 */
const MAX_OUTPUT_TOKENS = 16384;

/**
 * Native OpenAI web search via the **Responses API** (`client.responses`),
 * used when a user has a direct-OpenAI BYOK key AND web search is on. Unlike
 * the Chat Completions path (used for everything else on the openai-sdk
 * route), the Responses API exposes the server-side `web_search` tool that
 * works on normal models (gpt-4o / gpt-4.1 / gpt-5…) — Chat Completions web
 * search only works on the deprecated `*-search-preview` models.
 *
 * Mapped onto the same transport-neutral `ChatStreamEvent` union the rest of
 * chat.service speaks, so the controller is identical to the other routes.
 *
 * Event mapping (Responses streaming):
 *   - `response.output_text.delta`            → ChatStreamEvent.content
 *   - `response.output_text.annotation.added` → collected url_citations,
 *                                               emitted once as .citations
 *   - `response.web_search_call.completed`    → counts a billable search
 *                                               (distinct completed calls)
 *   - `response.completed`                    → usage totals (+ search count)
 *   - `response.failed` / `response.incomplete` → ChatStreamEvent.error
 *
 * Notes vs the Anthropic path:
 *   - The agentic loop runs server-side, so one turn can call web_search many
 *     times. OpenAI has no per-request cap param, so we can't bound it like
 *     Anthropic's `max_uses`; we count distinct completed calls and bill them
 *     accurately ($0.01 each — the controller does the true-up). BYOK, so the
 *     user's own OpenAI account pays.
 *   - Output items arrive interleaved (reasoning, web_search_call, message…);
 *     we react PER EVENT TYPE, never by position.
 */
@Injectable()
export class OpenAiResponsesClientService {
  async *sendMessageStream(
    messages: ChatMessage[],
    model: string,
    apiKey: string,
    baseURL: string,
    context: string | undefined,
    options: StreamOptions = {},
  ): AsyncIterable<ChatStreamEvent> {
    const client = new OpenAI({
      baseURL,
      apiKey: apiKey || 'no-auth',
      defaultHeaders: {
        'HTTP-Referer': process.env['SITE_URL'] || '',
        'X-Title': process.env['SITE_NAME'] || 'WorkenAI',
      },
    });

    // Anthropic requires a user-led history; the Responses API is lenient, but
    // we keep the same defensive trim so a stale assistant-led fragment can't
    // confuse the model.
    const input = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    // Citations dedup by URL across the whole turn (the same source can be
    // cited by multiple spans / multiple searches).
    const citationsByUrl = new Map<string, { url: string; title?: string }>();
    let webSearchRequests = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    let stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>;
    try {
      stream = await client.responses.create(
        {
          model,
          // Project context goes into `instructions` (the Responses API's
          // top-level system slot), not an input message.
          ...(context
            ? {
                instructions:
                  'Use the following project context to inform your answers. Reference this information when relevant.\n\n' +
                  context,
              }
            : {}),
          input,
          tools: [{ type: 'web_search' }],
          max_output_tokens: MAX_OUTPUT_TOKENS,
          stream: true,
        },
        { signal: options.signal },
      );
    } catch (err) {
      yield this.toErrorEvent(err);
      return;
    }

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'response.output_text.delta':
            yield { type: 'content', delta: event.delta };
            break;
          case 'response.output_text.annotation.added': {
            const ann = event.annotation as {
              type?: string;
              url?: string;
              title?: string;
            };
            if (
              ann?.type === 'url_citation' &&
              typeof ann.url === 'string' &&
              ann.url.length > 0 &&
              !citationsByUrl.has(ann.url)
            ) {
              citationsByUrl.set(ann.url, {
                url: ann.url,
                ...(typeof ann.title === 'string' && ann.title
                  ? { title: ann.title }
                  : {}),
              });
            }
            break;
          }
          case 'response.web_search_call.completed':
            // One distinct billable search ($0.01). Counting on `.completed`
            // (not in_progress/searching) avoids triple-counting the lifecycle.
            webSearchRequests += 1;
            break;
          case 'response.completed': {
            const u = event.response.usage;
            inputTokens = u?.input_tokens ?? 0;
            outputTokens = u?.output_tokens ?? 0;
            break;
          }
          case 'response.failed':
          case 'response.incomplete': {
            const reason =
              event.response.incomplete_details?.reason ??
              event.response.error?.message ??
              event.type;
            yield this.toErrorEvent(new Error(`Web search ${reason}`));
            return;
          }
          default:
            // message_start, reasoning deltas, web_search_call.in_progress /
            // .searching, output_item.*, etc. — no-op for our purposes.
            break;
        }
      }
    } catch (err) {
      // User-initiated Stop surfaces as AbortError once the signal fires;
      // return cleanly so the controller persists the partial buffer.
      if (
        options.signal?.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        return;
      }
      yield this.toErrorEvent(err);
      return;
    }

    if (citationsByUrl.size > 0) {
      yield { type: 'citations', citations: [...citationsByUrl.values()] };
    }

    // One usage event at the very end (OpenRouter parity). Anthropic/OpenAI
    // native don't return cost, so the controller backfills from the catalog
    // and adds the per-search surcharge from `webSearchRequests`.
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
    const message =
      err instanceof Error ? err.message : 'OpenAI web search request failed';
    const status =
      err && typeof err === 'object' && 'status' in err
        ? (err as { status?: number }).status
        : undefined;
    return { type: 'error', message, status };
  }
}
