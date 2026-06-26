import { Injectable } from '@nestjs/common';
import OpenAI, { AzureOpenAI } from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { AnthropicClientService } from '../integrations/anthropic-client.service.js';
import type { ChatTransportKind } from '../integrations/chat-transport.service.js';
import { DEFAULT_CHAT_MODEL } from './chat.constants.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning_details?: unknown;
}

/** Provider-agnostic tool (function-calling) definition. */
export interface ChatTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
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
  tool_calls?: {
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }[];
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
 *  - `usage` — token + cost totals. Summed across tool-loop iterations and
 *    emitted exactly once, after the final answer.
 *  - `tool_call` / `tool_result` — a function-calling round-trip: the model
 *    asked to call a tool, and the executed result. Surfaced so the FE can
 *    show "calling ARSO weather…" and persisted for transcript fidelity.
 *  - `error` — upstream provider error mid-stream (HTTP status + body).
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
  | {
      type: 'tool_call';
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      id: string;
      name: string;
      ok: boolean;
      summary: string;
      latencyMs: number;
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
  /** Function-calling tools to offer the model (openai-sdk path). When
   *  absent the request is byte-for-byte the no-tools call. The caller
   *  only sets this for models that support tools. */
  tools?: ChatTool[];
  /** Executes a tool the model called; returns the (JSON-serializable)
   *  result. Injected by the controller (e.g. ARSO dispatch) so this
   *  service stays decoupled from any specific tool module. */
  runTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Safety cap on tool-loop round-trips. Default 5. */
  maxToolIters?: number;
  /** Run before every tool-loop *re-call* (not the first model call). Throws
   *  to abort the loop — the controller wires this to the spend-budget gate so
   *  a multi-iteration tool loop can't run away on cost. */
  onBeforeToolIteration?: () => Promise<void>;
}

// Cap the tool result we feed back to the model so a huge ARSO payload
// (e.g. every air-quality station) can't blow the context window.
const MAX_TOOL_RESULT_CHARS = 6000;

/**
 * Stateful sanitizer that re-routes `<think>…</think>` blocks some reasoning
 * models leak into the `content` field over to the `reasoning` event. Kept as
 * a factory so each provider stream (each tool-loop iteration) gets a fresh,
 * isolated buffer. Logic preserved verbatim from the original inline version.
 */
function createThinkSanitizer() {
  let inThinkBlock = false;
  let pending = '';
  const OPEN_TAG = '<think>';
  const CLOSE_TAG = '</think>';

  const tagPrefix = (buf: string, tag: string): number => {
    const max = Math.min(buf.length, tag.length - 1);
    for (let k = max; k > 0; k--) {
      if (tag.startsWith(buf.slice(-k))) return k;
    }
    return 0;
  };

  function* sanitize(
    text: string,
  ): Generator<{ type: 'content' | 'reasoning'; delta: string }> {
    pending += text;
    while (pending.length > 0) {
      if (inThinkBlock) {
        const closeIdx = pending.indexOf(CLOSE_TAG);
        if (closeIdx === -1) {
          const hold = tagPrefix(pending, CLOSE_TAG);
          const flushable = pending.slice(0, pending.length - hold);
          if (flushable.length > 0) {
            yield { type: 'reasoning', delta: flushable };
          }
          pending = pending.slice(pending.length - hold);
          break;
        }
        const before = pending.slice(0, closeIdx);
        if (before.length > 0) yield { type: 'reasoning', delta: before };
        pending = pending.slice(closeIdx + CLOSE_TAG.length);
        inThinkBlock = false;
        continue;
      }
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
        if (flushable.length > 0) yield { type: 'content', delta: flushable };
        pending = pending.slice(pending.length - hold);
        break;
      }
      const before = pending.slice(0, earliest);
      if (before.length > 0) yield { type: 'content', delta: before };
      if (earliest === openIdx) {
        pending = pending.slice(earliest + OPEN_TAG.length);
        inThinkBlock = true;
      } else {
        pending = pending.slice(earliest + CLOSE_TAG.length);
      }
    }
  }

  function flush(): { type: 'content' | 'reasoning'; delta: string } | null {
    if (pending.length === 0) return null;
    const ev = {
      type: inThinkBlock ? ('reasoning' as const) : ('content' as const),
      delta: pending,
    };
    pending = '';
    return ev;
  }

  return { sanitize, flush };
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
      apiKey: apiKey || 'no-auth',
      defaultHeaders,
    });
  }

  private errorEvent(err: unknown): ChatStreamEvent {
    return {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      status:
        err && typeof err === 'object' && 'status' in err
          ? (err as { status?: number }).status
          : undefined,
    };
  }

  /**
   * Short, human-readable one-liner about a tool result for the inline UI step
   * and the persisted transcript ("Ljubljana: 18 °C, pretežno jasno"). Falls
   * back to a trimmed JSON slice for unknown shapes so nothing is ever blank.
   */
  private summarizeToolResult(
    ok: boolean,
    name: string,
    result: unknown,
  ): string {
    if (!ok) {
      const msg =
        result && typeof result === 'object' && 'error' in result
          ? String((result as { error?: unknown }).error)
          : 'failed';
      return msg.slice(0, 160);
    }
    const r = (result ?? {}) as Record<string, unknown>;
    const num = (v: unknown): string | null =>
      typeof v === 'number' && Number.isFinite(v) ? String(v) : null;
    try {
      if (name === 'arso_weather_forecast' && Array.isArray(r.forecast)) {
        const loc = typeof r.location === 'string' ? r.location : '';
        const p0 = r.forecast[0] as Record<string, unknown> | undefined;
        const temp = p0 ? num(p0.tempC) : null;
        const sky = p0 && typeof p0.weather === 'string' ? p0.weather : null;
        const tail = [temp ? `${temp} °C` : null, sky]
          .filter(Boolean)
          .join(', ');
        return [loc, tail].filter(Boolean).join(': ').slice(0, 160) || 'ok';
      }
      if (name === 'arso_air_quality' && Array.isArray(r.readings)) {
        const a0 = r.readings[0] as Record<string, unknown> | undefined;
        const station =
          a0 && typeof a0.station === 'string' ? a0.station : null;
        const pm10 = a0 ? num(a0.pm10) : null;
        const parts = [station, pm10 ? `PM10 ${pm10} µg/m³` : null].filter(
          Boolean,
        );
        return (parts.join(': ') || `${r.readings.length} postaj`).slice(
          0,
          160,
        );
      }
      if (name === 'arso_river_level' && Array.isArray(r.readings)) {
        const h0 = r.readings[0] as Record<string, unknown> | undefined;
        const river = h0 && typeof h0.river === 'string' ? h0.river : null;
        const station =
          h0 && typeof h0.station === 'string' ? h0.station : null;
        const level = h0 ? num(h0.waterLevelCm) : null;
        const where = [river, station].filter(Boolean).join(' @ ');
        const parts = [where, level ? `${level} cm` : null].filter(Boolean);
        return (parts.join(': ') || `${r.readings.length} postaj`).slice(
          0,
          160,
        );
      }
      return JSON.stringify(result).slice(0, 160);
    } catch {
      return 'ok';
    }
  }

  /**
   * Stream a chat completion as a sequence of transport-neutral
   * `ChatStreamEvent`s. Routing: Anthropic native SDK when
   * `kind === 'anthropic-sdk'`, OpenAI-compatible path otherwise.
   *
   * When `options.tools` is provided, this runs an agentic loop: stream → if
   * the model asked for tool calls, run them via `options.runTool`, append the
   * results, and re-call — up to `maxToolIters`. Both routes (openai-sdk here,
   * anthropic-sdk in the adapter) implement the loop. Without `tools` the loop
   * runs exactly once, so behaviour is identical to the single-shot version.
   */
  async *sendMessageStream(
    messages: ChatMessage[],
    model: string = DEFAULT_CHAT_MODEL,
    enableReasoning: boolean = true,
    context?: string,
    apiKey: string = '',
    baseURL: string = 'https://openrouter.ai/api/v1',
    kind: ChatTransportKind = 'openai-sdk',
    options: StreamOptions = {},
  ): AsyncIterable<ChatStreamEvent> {
    if (kind === 'anthropic-sdk') {
      // Anthropic native path runs its own tool_use loop (Phase C2); it reads
      // tools / runTool / maxToolIters from the same options and maps tool_use
      // blocks onto the shared tool_call / tool_result events.
      yield* this.anthropic.sendMessageStream(
        messages.map((m) => ({ role: m.role, content: m.content })),
        model,
        apiKey,
        context,
        options,
      );
      return;
    }

    // ── OpenAI-compatible path (OpenRouter + BYOK predefined + Azure) ──
    const azure =
      kind === 'azure-sdk' && options.azureEndpoint && options.azureApiVersion
        ? {
            endpoint: options.azureEndpoint,
            apiVersion: options.azureApiVersion,
            deployment: model,
          }
        : undefined;
    const client = this.makeClient(baseURL, apiKey, azure);

    // Tools: Azure 400s on unknown args, so only the non-azure routes get
    // them; only when the caller actually passed some.
    const toolDefs =
      kind !== 'azure-sdk' && options.tools && options.tools.length > 0
        ? options.tools
        : undefined;
    const maxIters = options.maxToolIters ?? 5;
    const runTool = options.runTool;

    // The growing conversation we send the provider. Starts with the system
    // context + the incoming history; tool turns (assistant tool_calls +
    // tool results) get appended between iterations.
    const convo: ChatCompletionMessageParam[] = [];
    if (context) {
      convo.push({
        role: 'system',
        content:
          'Use the following project context to inform your answers. Reference this information when relevant.\n\n' +
          context,
      });
    }
    for (const msg of messages) {
      convo.push({
        role: msg.role,
        content: msg.content,
        ...(msg.reasoning_details
          ? { reasoning_details: msg.reasoning_details }
          : {}),
      } as ChatCompletionMessageParam);
    }

    // Usage is summed across iterations and emitted once at the very end.
    let uPrompt = 0;
    let uCompletion = 0;
    let uTotal = 0;
    let uCost: number | undefined;
    let sawUsage = false;

    let iter = 0;
    while (true) {
      // Before every model call except the first (each tool-loop re-call),
      // honor a mid-loop Stop and re-check the spend budget — a tool loop must
      // not run away on cost. onBeforeToolIteration throws when over budget.
      if (iter > 0) {
        if (options.signal?.aborted) return;
        try {
          await options.onBeforeToolIteration?.();
        } catch (err) {
          yield this.errorEvent(err);
          return;
        }
      }
      const body: OpenRouterStreamingParams = {
        model,
        messages: convo,
        stream: true,
        stream_options: { include_usage: true },
        ...(enableReasoning &&
          kind !== 'azure-sdk' && { reasoning: { enabled: true } }),
        ...(options.webSearch && { plugins: [{ id: 'web' }] }),
        ...(toolDefs && {
          tools: toolDefs.map(
            (t): ChatCompletionTool => ({
              type: 'function',
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              },
            }),
          ),
          tool_choice: 'auto',
        }),
      };

      let stream;
      try {
        stream = await client.chat.completions.create(body, {
          signal: options.signal,
        });
      } catch (err) {
        yield this.errorEvent(err);
        return;
      }

      const san = createThinkSanitizer();
      const citations = new Map<string, string | undefined>();
      const toolAcc: Record<
        number,
        { id: string; name: string; args: string }
      > = {};

      try {
        for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
          const choice = chunk.choices?.[0];
          const delta: OpenRouterDelta | undefined = choice?.delta;

          // tool_calls stream incrementally: id + name arrive on the first
          // delta for an index, arguments accumulate over subsequent ones.
          for (const tc of delta?.tool_calls ?? []) {
            const acc = (toolAcc[tc.index] ??= { id: '', name: '', args: '' });
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.args += tc.function.arguments;
          }

          if (delta?.reasoning) {
            yield { type: 'reasoning', delta: delta.reasoning };
          }
          for (const ann of delta?.annotations ?? []) {
            if (ann?.type && ann.type !== 'url_citation') continue;
            const url = ann.url_citation?.url;
            if (typeof url !== 'string' || url.length === 0) continue;
            if (citations.has(url)) continue;
            const title = ann.url_citation?.title;
            citations.set(url, typeof title === 'string' ? title : undefined);
          }
          if (delta?.content) {
            for (const ev of san.sanitize(delta.content)) yield ev;
          }
          const usage = chunk.usage as OpenRouterUsage | undefined;
          if (usage && usage.total_tokens != null) {
            sawUsage = true;
            uPrompt += usage.prompt_tokens ?? 0;
            uCompletion += usage.completion_tokens ?? 0;
            uTotal += usage.total_tokens ?? 0;
            if (usage.cost != null) uCost = (uCost ?? 0) + usage.cost;
          }
        }
        const tail = san.flush();
        if (tail) yield tail;
        if (citations.size > 0) {
          yield {
            type: 'citations',
            citations: Array.from(citations, ([url, title]) => ({
              url,
              title,
            })),
          };
        }
      } catch (err) {
        // User-initiated Stop arrives as an AbortError. Return cleanly so the
        // controller persists the buffered content with metadata.partial.
        if (
          options.signal?.aborted ||
          (err instanceof Error && err.name === 'AbortError')
        ) {
          return;
        }
        yield this.errorEvent(err);
        return;
      }

      const calls = Object.values(toolAcc).filter((c) => c.name);
      // Normal completion (no tool request) → done.
      if (!toolDefs || !runTool || calls.length === 0) break;
      // Safety cap — stop looping and let whatever text we have stand.
      if (++iter >= maxIters) break;
      // Honor a Stop that arrived during streaming before spending on tools.
      if (options.signal?.aborted) return;

      // Record the assistant's tool_calls turn, then run each tool and append
      // its result, so the next iteration lets the model use the data.
      convo.push({
        role: 'assistant',
        content: null,
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.args || '{}' },
        })),
      } as ChatCompletionMessageParam);

      for (const c of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = c.args ? (JSON.parse(c.args) as Record<string, unknown>) : {};
        } catch {
          args = {};
        }
        yield { type: 'tool_call', id: c.id, name: c.name, arguments: args };

        const t0 = Date.now();
        let ok = true;
        let result: unknown;
        try {
          result = await runTool(c.name, args);
        } catch (err) {
          ok = false;
          result = {
            error: err instanceof Error ? err.message : String(err),
          };
        }
        yield {
          type: 'tool_result',
          id: c.id,
          name: c.name,
          ok,
          summary: this.summarizeToolResult(ok, c.name, result),
          latencyMs: Date.now() - t0,
        };

        convo.push({
          role: 'tool',
          tool_call_id: c.id,
          content: JSON.stringify(result).slice(0, MAX_TOOL_RESULT_CHARS),
        });
      }
      // Loop: re-call the model now that it can see the tool results.
    }

    if (sawUsage) {
      yield {
        type: 'usage',
        promptTokens: uPrompt,
        completionTokens: uCompletion,
        totalTokens: uTotal,
        costUsd: uCost,
      };
    }
  }
}
