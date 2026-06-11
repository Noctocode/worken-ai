import { Injectable } from '@nestjs/common';
import OpenAI, { AzureOpenAI } from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import { AnthropicClientService } from '../integrations/anthropic-client.service.js';
import type { ChatTransportKind } from '../integrations/chat-transport.service.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning_details?: unknown;
}

/**
 * OpenRouter accepts a few request-body fields the OpenAI SDK types don't
 * model (`reasoning` toggle, `plugins`). We extend the SDK's streaming
 * params with them so the create() call type-checks against the streaming
 * overload (and returns a typed `Stream<ChatCompletionChunk>`) instead of
 * collapsing to `any`.
 */
interface OpenRouterStreamingParams extends ChatCompletionCreateParamsStreaming {
  reasoning?: { enabled: boolean };
  plugins?: { id: string }[];
}

/** OpenRouter streams a `reasoning` delta + `annotations` the OpenAI chunk
 *  type doesn't model. Narrowed shape we read those extension fields from. */
interface OpenRouterDelta {
  content?: string | null;
  reasoning?: string;
  annotations?: {
    type?: string;
    url_citation?: { url?: string; title?: string };
  }[];
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
  | {
      type: 'citations';
      /** Web-search sources OpenRouter attached to the answer. */
      citations: { url: string; title?: string }[];
    }
  | { type: 'error'; message: string; status?: number };

export interface StreamOptions {
  /** Bound to the upstream SDK so a FE disconnect (or explicit Stop)
   *  aborts the underlying HTTP call instead of running it to
   *  completion and discarding the bytes. */
  signal?: AbortSignal;
  /** When true, augments the OpenRouter request with the web search
   *  plugin (`plugins: [{ id: "web" }]`) so the model can browse the
   *  live web. OpenRouter (openai-sdk) path only; ignored for native
   *  Anthropic BYOK. */
  webSearch?: boolean;
  /** Azure OpenAI ('azure-sdk') only: per-resource endpoint
   *  (https://{resource}.openai.azure.com). Carried here so the call
   *  signature stays stable. */
  azureEndpoint?: string;
  /** Azure OpenAI ('azure-sdk') only: api-version query param. */
  azureApiVersion?: string;
}

@Injectable()
export class ChatService {
  constructor(private readonly anthropic: AnthropicClientService) {}

  private makeClient(
    baseURL: string,
    apiKey: string,
    azure?: { endpoint: string; apiVersion: string; deployment: string },
  ): OpenAI {
    const defaultHeaders = {
      'HTTP-Referer': process.env['SITE_URL'] || '',
      'X-Title': process.env['SITE_NAME'] || 'WorkenAI',
    };
    // Azure OpenAI: same chat.completions wire format, but the SDK needs
    // the per-resource endpoint, api-version, and deployment (which it
    // uses as the path segment). AzureOpenAI extends OpenAI, so callers
    // keep using `.chat.completions.create` unchanged.
    if (azure) {
      return new AzureOpenAI({
        endpoint: azure.endpoint,
        apiVersion: azure.apiVersion,
        deployment: azure.deployment,
        apiKey: apiKey || 'no-auth',
        defaultHeaders,
      });
    }
    return new OpenAI({
      baseURL,
      // OpenAI SDK rejects empty apiKey; pass a placeholder for endpoints
      // that don't need auth (rare — local Ollama, internal vLLM, …).
      apiKey: apiKey || 'no-auth',
      defaultHeaders,
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

    // Azure routes through the AzureOpenAI client; `model` is the
    // deployment name (already resolved by chat-transport). All other
    // OpenAI-compatible routes keep the plain baseURL client.
    const azure =
      kind === 'azure-sdk' && options.azureEndpoint && options.azureApiVersion
        ? {
            endpoint: options.azureEndpoint,
            apiVersion: options.azureApiVersion,
            deployment: model,
          }
        : undefined;

    const body: OpenRouterStreamingParams = {
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
      // `reasoning` is an OpenRouter extension — Azure OpenAI 400s on
      // unknown body args, so never send it on the azure-sdk route.
      ...(enableReasoning &&
        kind !== 'azure-sdk' && { reasoning: { enabled: true } }),
      // OpenRouter web search plugin — lets the model browse the live
      // web. Kept off the model id (no `:online` suffix) so catalog
      // pricing / observability lookups still match the base model.
      ...(options.webSearch && { plugins: [{ id: 'web' }] }),
    };

    let stream;
    try {
      stream = await this.makeClient(
        baseURL,
        apiKey,
        azure,
      ).chat.completions.create(body, {
        signal: options.signal,
      });
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

    // Some reasoning models (notably free-tier nvidia/nemotron-…
    // -reasoning and a few qwen-r1 forks) wrap their thinking in raw
    // <think>…</think> tags inside the `content` field instead of
    // routing it through OpenRouter's `reasoning` channel. When that
    // happens the literal tags + chain-of-thought leak into the
    // visible bubble. The sanitizer below splits `content` deltas on
    // the tag boundaries and re-routes the in-block text to the
    // `reasoning` event so the FE thinking pane catches it.
    //
    // Stateful across the stream: a tag can straddle two chunks
    // ("<thi" + "nk>"), so we keep `inThinkBlock` and a small
    // `pending` buffer that holds up to one tag-width of unflushed
    // bytes between deltas.
    let inThinkBlock = false;
    let pending = '';
    const OPEN_TAG = '<think>';
    const CLOSE_TAG = '</think>';

    // How many trailing bytes of `buf` could be a prefix of `tag`?
    // Used so we hold back the minimum necessary bytes — most chunks
    // don't end in `<` or `</`, so most calls hold back 0 and the
    // stream feels token-by-token rather than coalesced.
    const tagPrefix = (buf: string, tag: string): number => {
      const max = Math.min(buf.length, tag.length - 1);
      for (let k = max; k > 0; k--) {
        if (tag.startsWith(buf.slice(-k))) return k;
      }
      return 0;
    };

    // Walk through `text` byte-by-byte, splitting on whichever tag
    // ends the current mode and yielding the right event type for
    // each segment. The leftover (a partial tag at the end, if any)
    // stays in `pending` for the next call.
    const sanitize = function* (
      this: void,
      text: string,
    ): Generator<{ type: 'content' | 'reasoning'; delta: string }> {
      pending += text;
      while (pending.length > 0) {
        if (inThinkBlock) {
          const closeIdx = pending.indexOf(CLOSE_TAG);
          if (closeIdx === -1) {
            // No close tag yet. Flush all but a possible trailing
            // prefix of </think>; the next chunk will complete the
            // match (or not, in which case the leftover is
            // legitimate reasoning bytes).
            const hold = tagPrefix(pending, CLOSE_TAG);
            const flushable = pending.slice(0, pending.length - hold);
            if (flushable.length > 0) {
              yield { type: 'reasoning', delta: flushable };
            }
            pending = pending.slice(pending.length - hold);
            break;
          }
          const before = pending.slice(0, closeIdx);
          if (before.length > 0) {
            yield { type: 'reasoning', delta: before };
          }
          pending = pending.slice(closeIdx + CLOSE_TAG.length);
          inThinkBlock = false;
          continue;
        }
        // Content mode: scan for whichever of <think> / </think>
        // comes first. The orphan </think> case (close tag with no
        // matching open in this stream) gets dropped — that's the
        // free-tier-nemotron leak we're guarding against. Treating
        // the orphan as a strip-only no-op (mode stays "content")
        // keeps the visible bubble clean without misclassifying
        // subsequent answer text as reasoning.
        const openIdx = pending.indexOf(OPEN_TAG);
        const orphanIdx = pending.indexOf(CLOSE_TAG);
        const earliest =
          openIdx === -1
            ? orphanIdx
            : orphanIdx === -1
              ? openIdx
              : Math.min(openIdx, orphanIdx);
        if (earliest === -1) {
          const hold = Math.max(
            tagPrefix(pending, OPEN_TAG),
            tagPrefix(pending, CLOSE_TAG),
          );
          const flushable = pending.slice(0, pending.length - hold);
          if (flushable.length > 0) {
            yield { type: 'content', delta: flushable };
          }
          pending = pending.slice(pending.length - hold);
          break;
        }
        const before = pending.slice(0, earliest);
        if (before.length > 0) {
          yield { type: 'content', delta: before };
        }
        if (earliest === openIdx) {
          pending = pending.slice(earliest + OPEN_TAG.length);
          inThinkBlock = true;
        } else {
          // Orphan </think> — drop the tag, stay in content mode.
          pending = pending.slice(earliest + CLOSE_TAG.length);
        }
      }
    };

    // Web-search citations OpenRouter attaches via `delta.annotations`.
    // They usually arrive on the final content chunk; we dedupe by URL
    // across the stream and emit one `citations` event at the end so the
    // FE can render a Sources list.
    const citations = new Map<string, string | undefined>();

    try {
      for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
        // OpenRouter emits `reasoning` deltas through a non-standard
        // field on the delta object. The OpenAI types don't model it,
        // so we read through a loose shape and emit a separate event
        // type — FE shows reasoning in a "thinking" pane rather than
        // inlining it into the assistant text.
        const choice = chunk.choices?.[0];
        const delta: OpenRouterDelta | undefined = choice?.delta;
        if (delta?.reasoning) {
          yield { type: 'reasoning', delta: delta.reasoning };
        }
        for (const ann of delta?.annotations ?? []) {
          // Providers may emit other annotation kinds; only collect URL
          // citations, and validate the fields are strings so the SSE
          // payload + persisted metadata stay predictable.
          if (ann?.type && ann.type !== 'url_citation') continue;
          const url = ann.url_citation?.url;
          if (typeof url !== 'string' || url.length === 0) continue;
          if (citations.has(url)) continue;
          const title = ann.url_citation?.title;
          citations.set(url, typeof title === 'string' ? title : undefined);
        }
        if (delta?.content) {
          for (const ev of sanitize(delta.content)) {
            yield ev;
          }
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
      // End of stream — flush whatever's left in the sanitizer's
      // peek buffer. We held the last few bytes back in case they
      // were the start of a tag; now that the stream is closed, they
      // can't be, so they belong in the user-visible event.
      if (pending.length > 0) {
        yield {
          type: inThinkBlock ? 'reasoning' : 'content',
          delta: pending,
        };
        pending = '';
      }
      // Emit collected web-search sources once, after the answer text.
      if (citations.size > 0) {
        yield {
          type: 'citations',
          citations: Array.from(citations, ([url, title]) => ({ url, title })),
        };
      }
    } catch (err) {
      // User-initiated Stop arrives as an AbortError once the
      // signal we forwarded into the SDK fires. Return cleanly —
      // the controller already knows the client disconnected (via
      // req.on('close')) and will persist the buffered content
      // with metadata.partial = true. Yielding an `error` event
      // here would flip streamErrored=true and skip persistence,
      // contradicting the cancellation contract.
      if (
        options.signal?.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        return;
      }
      // Genuine mid-stream error (provider terminated unexpectedly,
      // network blip, etc.) — surface so the controller can map
      // it to an SSE `error` event and skip persistence.
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
