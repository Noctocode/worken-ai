import { Injectable } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import type { Content, GenerateContentResponse, Tool } from '@google/genai';
import type { ChatStreamEvent, StreamOptions } from '../chat/chat.service.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Google Search grounding tool — Gemini's native web search. The model
 * decides when to search; results come back as `groundingMetadata` (web
 * sources) which we surface as `citations`. No account-level toggle is
 * required (unlike Anthropic) — grounding is available with any key on a
 * billing-enabled project.
 */
const GOOGLE_SEARCH_TOOL: Tool = { googleSearch: {} };

/**
 * Whether a "google/..." slug maps to a Gemini model on Google's native
 * API whose name matches the bare slug. Two reasons to gate:
 *   - Google Search grounding needs Gemini 2.0+ — the whole point of the
 *     native route here.
 *   - The older 1.x OpenRouter slugs reorder the name (`gemini-flash-1.5`
 *     vs native `gemini-1.5-flash`), so sending the bare slug to Google
 *     404s. We only route 2.x+ natively and let everything else (1.x,
 *     gemma, learnlm, …) fall through to OpenRouter, where the slug works.
 *
 * Pure + dependency-free so chat-transport can gate routing and tests can
 * audit the predicate without a client.
 */
export function isGeminiNativeSupported(modelId: string): boolean {
  const slash = modelId.indexOf('/');
  const bare = slash === -1 ? modelId : modelId.slice(slash + 1);
  // gemini-2.x, gemini-3.x, … (a digit ≥ 2, or a multi-digit major).
  return /^gemini-(?:[2-9]|\d{2,})/.test(bare);
}

/**
 * Native Google Gemini SDK wrapper. Used when a user has a BYOK key for
 * the "google" provider — we bypass OpenRouter and call the Gemini API
 * directly so the user pays Google rather than the OpenRouter markup.
 *
 * Gemini's API differs from OpenAI's in ways that matter here:
 *   1. `system` is a top-level `systemInstruction`, not a message.
 *   2. The assistant role is `"model"`, not `"assistant"`.
 *   3. Web search is the server-side `googleSearch` grounding tool, and
 *      sources arrive as `groundingMetadata.groundingChunks` rather than
 *      inline citations.
 *
 * Extended "thinking" is not surfaced separately yet — it would map to a
 * `reasoning` event once the FE adds a thinking pane.
 */
@Injectable()
export class GeminiClientService {
  /**
   * Streaming chat mapped onto the transport-neutral `ChatStreamEvent`
   * union owned by `chat.service`:
   *   - text parts → `content`
   *   - `groundingMetadata` web sources → one `citations` event (deduped)
   *   - `usageMetadata` → `usage`; Gemini returns no cost, so the
   *     controller backfills via the catalog estimator. A grounded turn
   *     reports `webSearchRequests: 1` so the caller adds the grounding
   *     surcharge (Google bills per grounded request, not per query).
   */
  async *sendMessageStream(
    messages: ChatMessage[],
    model: string,
    apiKey: string,
    context?: string,
    options: StreamOptions = {},
  ): AsyncIterable<ChatStreamEvent> {
    if (!apiKey) {
      yield {
        type: 'error',
        message: 'Google API key is required for native routing',
      };
      return;
    }

    const ai = new GoogleGenAI({ apiKey });

    // Gemini takes the system prompt as a top-level `systemInstruction`
    // and uses role 'model' for the assistant. Drop leading non-user
    // messages defensively, like the Anthropic adapter.
    const filtered = [...messages];
    while (filtered.length > 0 && filtered[0].role !== 'user') filtered.shift();
    const contents: Content[] = filtered.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    // Citations dedup by URL — the same source can ground multiple spans.
    const citationsByUrl = new Map<string, { url: string; title?: string }>();
    let grounded = false;
    let promptTokens = 0;
    let outputTokens = 0;

    let stream: AsyncGenerator<GenerateContentResponse>;
    try {
      stream = await ai.models.generateContentStream({
        model,
        contents,
        config: {
          ...(context ? { systemInstruction: context } : {}),
          ...(options.webSearch ? { tools: [GOOGLE_SEARCH_TOOL] } : {}),
          abortSignal: options.signal,
        },
      });
    } catch (err) {
      yield this.toErrorEvent(err);
      return;
    }

    try {
      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) yield { type: 'content', delta: text };

        const gm = chunk.candidates?.[0]?.groundingMetadata;
        if (gm) {
          grounded = true;
          for (const gc of gm.groundingChunks ?? []) {
            const url = gc.web?.uri;
            if (!url || citationsByUrl.has(url)) continue;
            citationsByUrl.set(url, {
              url,
              ...(gc.web?.title ? { title: gc.web.title } : {}),
            });
          }
        }

        // usageMetadata is cumulative across the stream — keep the latest.
        const um = chunk.usageMetadata;
        if (um) {
          promptTokens = um.promptTokenCount ?? promptTokens;
          outputTokens = um.candidatesTokenCount ?? outputTokens;
        }
      }
    } catch (err) {
      // Same abort handling as the other adapters: a user-initiated Stop
      // surfaces as AbortError once the signal fires. Return cleanly so
      // the controller persists the buffered content with partial = true.
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
      ...(grounded ? { webSearchRequests: 1 } : {}),
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
