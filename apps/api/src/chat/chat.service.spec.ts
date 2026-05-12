import {
  ChatService,
  type ChatStreamEvent,
} from './chat.service.js';

/**
 * Stream tests focus on `sendMessageStream` — the seam where SDK
 * chunk shapes are mapped onto our transport-neutral
 * `ChatStreamEvent` union. They don't exercise the SDKs themselves:
 * the OpenAI/OpenRouter client is replaced with a tiny stub that
 * yields synthetic chunks, and the Anthropic adapter is stubbed at
 * the service-level via a minimal `AnthropicClientService` double.
 *
 * Anything the production code does downstream of these events
 * (SSE serialisation, guardrail re-eval, observability) lives in
 * the controller and gets its own coverage there.
 */

interface OpenAIChunk {
  choices?: Array<{
    delta?: { content?: string; reasoning?: string };
    finish_reason?: string;
  }>;
  usage?: {
    cost?: number;
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

/**
 * Build a ChatService with the OpenAI client's `chat.completions.create`
 * patched to return an async-iterable over the supplied chunks. The
 * AbortSignal forwarded by the stream code is ignored — that path
 * is covered by the chat-controller spec where it's actually wired
 * to a real req.close.
 */
function makeServiceWithChunks(chunks: OpenAIChunk[]) {
  const anthropic = {
    // Compare-models calls this; the stream tests don't, so the
    // implementation is irrelevant.
    sendMessage: jest.fn(),
    sendMessageStream: jest.fn(),
  };
  const svc = new ChatService(anthropic as never);

  // Replace the private `makeClient` so we don't depend on a real
  // OpenAI install. The function signature is private but TS lets
  // us patch the instance after construction.
  (svc as unknown as { makeClient: () => unknown }).makeClient = () => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            for (const chunk of chunks) yield chunk;
          },
        }),
      },
    },
  });
  return svc;
}

async function collect(stream: AsyncIterable<ChatStreamEvent>) {
  const out: ChatStreamEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

describe('ChatService.sendMessageStream (openai-sdk path)', () => {
  it('yields content deltas in order', async () => {
    const svc = makeServiceWithChunks([
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: ', ' } }] },
      { choices: [{ delta: { content: 'world!' } }] },
    ]);
    const events = await collect(
      svc.sendMessageStream([{ role: 'user', content: 'hi' }]),
    );
    expect(events).toEqual([
      { type: 'content', delta: 'Hello' },
      { type: 'content', delta: ', ' },
      { type: 'content', delta: 'world!' },
    ]);
  });

  it('yields a separate reasoning event when the delta carries reasoning', async () => {
    const svc = makeServiceWithChunks([
      { choices: [{ delta: { reasoning: 'thinking…' } }] },
      { choices: [{ delta: { content: 'answer' } }] },
    ]);
    const events = await collect(
      svc.sendMessageStream([{ role: 'user', content: 'hi' }]),
    );
    expect(events).toEqual([
      { type: 'reasoning', delta: 'thinking…' },
      { type: 'content', delta: 'answer' },
    ]);
  });

  it('passes reasoning + content from the same chunk through as two events', async () => {
    const svc = makeServiceWithChunks([
      {
        choices: [
          { delta: { reasoning: 'r', content: 'c' } },
        ],
      },
    ]);
    const events = await collect(
      svc.sendMessageStream([{ role: 'user', content: 'hi' }]),
    );
    // Reasoning is yielded first by the production code so the FE
    // can populate the thinking pane before the visible answer
    // starts — assert that ordering explicitly.
    expect(events).toEqual([
      { type: 'reasoning', delta: 'r' },
      { type: 'content', delta: 'c' },
    ]);
  });

  it('emits exactly one usage event from the final stream_options chunk', async () => {
    const svc = makeServiceWithChunks([
      { choices: [{ delta: { content: 'hello' } }] },
      // Final chunk with usage populated. The production code reads
      // `usage.total_tokens` to detect this kind of chunk; chunks
      // without it don't trigger a usage event.
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: {
          total_tokens: 12,
          prompt_tokens: 4,
          completion_tokens: 8,
          cost: 0.0001,
        },
      },
    ]);
    const events = await collect(
      svc.sendMessageStream([{ role: 'user', content: 'hi' }]),
    );
    const usageEvents = events.filter((e) => e.type === 'usage');
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toEqual({
      type: 'usage',
      promptTokens: 4,
      completionTokens: 8,
      totalTokens: 12,
      costUsd: 0.0001,
    });
  });

  it('omits cost on the usage event when the provider did not include one', async () => {
    const svc = makeServiceWithChunks([
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: {
          total_tokens: 5,
          prompt_tokens: 2,
          completion_tokens: 3,
          // no `cost` (e.g. BYOK provider that doesn't expose it)
        },
      },
    ]);
    const events = await collect(
      svc.sendMessageStream([{ role: 'user', content: 'hi' }]),
    );
    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toBeDefined();
    if (usage?.type === 'usage') {
      expect(usage.costUsd).toBeUndefined();
    }
  });

  it('treats a chunk with no content / reasoning / usage as a no-op', async () => {
    const svc = makeServiceWithChunks([
      { choices: [{ delta: {} }] },
      { choices: [{ delta: { content: 'real text' } }] },
    ]);
    const events = await collect(
      svc.sendMessageStream([{ role: 'user', content: 'hi' }]),
    );
    expect(events).toEqual([{ type: 'content', delta: 'real text' }]);
  });

  it('surfaces SDK-level errors as a single error event then stops', async () => {
    const anthropic = {
      sendMessage: jest.fn(),
      sendMessageStream: jest.fn(),
    };
    const svc = new ChatService(anthropic as never);
    // Reject the pre-stream `create` call to simulate auth / model-
    // not-found. The production code is supposed to yield one
    // `error` event and return — we shouldn't see anything else.
    const err = Object.assign(new Error('bad key'), { status: 401 });
    (svc as unknown as { makeClient: () => unknown }).makeClient = () => ({
      chat: {
        completions: {
          create: jest.fn().mockRejectedValue(err),
        },
      },
    });

    const events = await collect(
      svc.sendMessageStream([{ role: 'user', content: 'hi' }]),
    );
    expect(events).toEqual([
      { type: 'error', message: 'bad key', status: 401 },
    ]);
  });

  it('delegates anthropic-sdk transport to the AnthropicClientService', async () => {
    async function* fakeAnthropicStream(): AsyncIterable<ChatStreamEvent> {
      yield { type: 'content', delta: 'hi from claude' };
      yield {
        type: 'usage',
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
      };
    }
    const anthropic = {
      sendMessage: jest.fn(),
      sendMessageStream: jest.fn().mockReturnValue(fakeAnthropicStream()),
    };
    const svc = new ChatService(anthropic as never);

    const events = await collect(
      svc.sendMessageStream(
        [{ role: 'user', content: 'hi' }],
        'anthropic/claude-sonnet-4.6',
        false,
        undefined,
        'sk-ant-…',
        undefined,
        'anthropic-sdk',
      ),
    );
    expect(anthropic.sendMessageStream).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      { type: 'content', delta: 'hi from claude' },
      {
        type: 'usage',
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
      },
    ]);
  });
});
