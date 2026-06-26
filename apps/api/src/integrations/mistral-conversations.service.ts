import { Injectable } from '@nestjs/common';
import { Mistral } from '@mistralai/mistralai';
import type { ChatStreamEvent, StreamOptions } from '../chat/chat.service.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Mistral web search runs ONLY through the Conversations API (the
 * `web_search` built-in connector) — not the OpenAI-compatible chat
 * completions endpoint our normal Mistral path uses. So when web search is
 * on for a Mistral BYOK call, chat.service diverts here; otherwise Mistral
 * stays on the fast chat-completions path.
 *
 * We start a one-off conversation (inline `model` + `tools`, no persisted
 * agent), stream it, and map Mistral's conversation events onto the
 * transport-neutral `ChatStreamEvent` union:
 *   - `message.output.delta` with string content → `content`
 *   - `message.output.delta` carrying a `tool_reference` chunk → `citations`
 *   - `conversation.response.done` → `usage`
 *   - `conversation.response.error` → `error`
 */
@Injectable()
export class MistralConversationsService {
  async *streamWithWebSearch(
    messages: ChatMessage[],
    model: string,
    apiKey: string,
    context?: string,
    options: StreamOptions = {},
  ): AsyncIterable<ChatStreamEvent> {
    if (!apiKey) {
      yield {
        type: 'error',
        message: 'Mistral API key is required for native routing',
      };
      return;
    }

    const client = new Mistral({ apiKey });

    // Mistral takes the system prompt as top-level `instructions`; the
    // conversation `inputs` are the {role, content} turns.
    const inputs = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const citationsByUrl = new Map<string, { url: string; title?: string }>();
    let promptTokens = 0;
    let outputTokens = 0;

    let stream: AsyncIterable<{ data?: unknown }>;
    try {
      stream = await client.beta.conversations.startStream(
        {
          model,
          inputs,
          ...(context ? { instructions: context } : {}),
          tools: [{ type: 'web_search' }],
        },
        { fetchOptions: { signal: options.signal } },
      );
    } catch (err) {
      yield this.toErrorEvent(err);
      return;
    }

    try {
      for await (const event of stream) {
        const data = event.data as MistralEventData | undefined;
        if (!data) continue;

        if (data.type === 'message.output.delta') {
          const c = data.content;
          if (typeof c === 'string') {
            if (c) yield { type: 'content', delta: c };
          } else if (c?.type === 'text' && typeof c.text === 'string') {
            if (c.text) yield { type: 'content', delta: c.text };
          } else if (c?.type === 'tool_reference' && c.url) {
            if (!citationsByUrl.has(c.url)) {
              citationsByUrl.set(c.url, {
                url: c.url,
                ...(c.title ? { title: c.title } : {}),
              });
            }
          }
        } else if (data.type === 'conversation.response.done') {
          promptTokens = data.usage?.promptTokens ?? promptTokens;
          outputTokens = data.usage?.completionTokens ?? outputTokens;
        } else if (data.type === 'conversation.response.error') {
          yield {
            type: 'error',
            message: data.message ?? 'Mistral conversation error',
          };
          return;
        }
      }
    } catch (err) {
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

    yield {
      type: 'usage',
      promptTokens,
      completionTokens: outputTokens,
      totalTokens: promptTokens + outputTokens,
    };
  }

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

/**
 * Flat, narrowed shape of the Mistral conversation stream events we read.
 * The SDK's full discriminated union is broad and carries many event types
 * we ignore; a flat optional shape lets us branch on `type` and read just
 * the text deltas, tool-reference citations, usage, and errors we care
 * about without fighting the union.
 */
interface MistralEventData {
  type?: string;
  content?:
    | string
    | { type?: string; text?: string; url?: string | null; title?: string };
  usage?: { promptTokens?: number; completionTokens?: number };
  message?: string;
}
