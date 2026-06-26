import { OpenAiResponsesClientService } from './openai-responses-client.service.js';
import type { ChatStreamEvent } from '../chat/chat.service.js';

/**
 * OpenAI Responses-API web-search adapter. The `openai` SDK is mocked at the
 * module boundary: `responses.create` resolves to a fake async-iterable of
 * Responses streaming events. We assert the adapter (a) injects the native
 * `web_search` tool, (b) streams `output_text.delta` as content, (c) surfaces
 * `url_citation` annotations as a deduped `citations` event, (d) counts
 * distinct `web_search_call.completed` onto the usage event, and (e) maps a
 * failed/incomplete response to a structured `error` event.
 */
const mockCreate = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    responses: { create: mockCreate },
  })),
}));

type FakeEvent = Record<string, unknown> & { type: string };

function makeStream(events: FakeEvent[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();
      for (const ev of events) yield ev;
    },
  };
}

/** Shape of the create() body we assert on (the mock erases SDK types). */
interface CreateParams {
  model: string;
  tools?: unknown;
  max_output_tokens?: number;
  input: Array<{ role: string }>;
}

async function collect(
  stream: AsyncIterable<ChatStreamEvent>,
): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const ev of stream) out.push(ev);
  return out;
}

describe('OpenAiResponsesClientService', () => {
  let svc: OpenAiResponsesClientService;

  beforeEach(() => {
    mockCreate.mockReset();
    svc = new OpenAiResponsesClientService();
  });

  it('injects web_search, streams text, dedups citations, counts searches', async () => {
    mockCreate.mockResolvedValue(
      makeStream([
        { type: 'response.output_text.delta', delta: 'Claude Shannon ' },
        { type: 'response.web_search_call.completed' },
        { type: 'response.web_search_call.in_progress' }, // ignored
        { type: 'response.output_text.delta', delta: 'was born in 1916.' },
        {
          type: 'response.output_text.annotation.added',
          annotation: {
            type: 'url_citation',
            url: 'https://en.wikipedia.org/wiki/Claude_Shannon',
            title: 'Claude Shannon - Wikipedia',
          },
        },
        {
          // Same URL again — must dedup to one citation.
          type: 'response.output_text.annotation.added',
          annotation: {
            type: 'url_citation',
            url: 'https://en.wikipedia.org/wiki/Claude_Shannon',
            title: 'Claude Shannon - Wikipedia',
          },
        },
        { type: 'response.web_search_call.completed' },
        {
          type: 'response.completed',
          response: { usage: { input_tokens: 12, output_tokens: 6 } },
        },
      ]),
    );

    const events = await collect(
      svc.sendMessageStream(
        [{ role: 'user', content: 'When was Claude Shannon born?' }],
        'gpt-5.5',
        'sk-key',
        'https://api.openai.com/v1',
        undefined,
        { openaiWebSearch: true },
      ),
    );

    // Native web_search tool injected; output budget set.
    const params = mockCreate.mock.calls[0][0] as CreateParams;
    expect(params.tools).toEqual([{ type: 'web_search' }]);
    expect(params.max_output_tokens).toBeGreaterThanOrEqual(8192);

    // Text deltas streamed through in order.
    const text = events
      .filter(
        (e): e is { type: 'content'; delta: string } => e.type === 'content',
      )
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('Claude Shannon was born in 1916.');

    // Citations surfaced once, deduped by URL.
    expect(events.find((e) => e.type === 'citations')).toEqual({
      type: 'citations',
      citations: [
        {
          url: 'https://en.wikipedia.org/wiki/Claude_Shannon',
          title: 'Claude Shannon - Wikipedia',
        },
      ],
    });

    // Two distinct web_search_call.completed → 2 billable searches.
    expect(events.find((e) => e.type === 'usage')).toMatchObject({
      promptTokens: 12,
      completionTokens: 6,
      webSearchRequests: 2,
    });
  });

  it('maps a failed response to an error event', async () => {
    mockCreate.mockResolvedValue(
      makeStream([
        { type: 'response.output_text.delta', delta: 'partial' },
        {
          type: 'response.failed',
          response: { error: { message: 'web search unavailable' } },
        },
      ]),
    );

    const events = await collect(
      svc.sendMessageStream(
        [{ role: 'user', content: 'hi' }],
        'gpt-5.5',
        'sk-key',
        'https://api.openai.com/v1',
        undefined,
        { openaiWebSearch: true },
      ),
    );

    const err = events.find((e) => e.type === 'error');
    expect(err).toMatchObject({ type: 'error' });
    expect((err as { message: string }).message).toContain(
      'web search unavailable',
    );
    // No usage/citations after a hard failure.
    expect(events.find((e) => e.type === 'usage')).toBeUndefined();
  });

  it('omits the search count when no search ran', async () => {
    mockCreate.mockResolvedValue(
      makeStream([
        { type: 'response.output_text.delta', delta: 'Hi there.' },
        {
          type: 'response.completed',
          response: { usage: { input_tokens: 3, output_tokens: 2 } },
        },
      ]),
    );

    const events = await collect(
      svc.sendMessageStream(
        [{ role: 'user', content: 'hi' }],
        'gpt-5.5',
        'sk-key',
        'https://api.openai.com/v1',
        undefined,
        { openaiWebSearch: true },
      ),
    );

    expect(events.find((e) => e.type === 'citations')).toBeUndefined();
    expect(events.find((e) => e.type === 'usage')).not.toHaveProperty(
      'webSearchRequests',
    );
  });
});
