import { MistralConversationsService } from './mistral-conversations.service.js';
import { mistralMock } from '../test-utils/mistralai.mock.js';
import type { ChatStreamEvent } from '../chat/chat.service.js';

/**
 * Mistral Conversations adapter. The ESM-only SDK is replaced by a stub via
 * jest `moduleNameMapper` (see test-utils/mistralai.mock); we drive its
 * `beta.conversations.startStream` here. We assert the adapter requests the
 * `web_search` tool, maps `message.output.delta` text to content,
 * `tool_reference` chunks to citations, and `conversation.response.done`
 * usage to a usage event.
 */
const mockStartStream = jest.fn();
mistralMock.startStream = mockStartStream;

interface FakeEvent {
  data: unknown;
}

function makeStream(events: FakeEvent[]): Promise<AsyncGenerator<FakeEvent>> {
  async function* gen(): AsyncGenerator<FakeEvent> {
    await Promise.resolve();
    for (const e of events) yield e;
  }
  return Promise.resolve(gen());
}

interface StartRequest {
  model: string;
  inputs: Array<{ role: string; content: string }>;
  instructions?: string;
  tools?: Array<{ type: string }>;
}

async function collect(
  stream: AsyncIterable<ChatStreamEvent>,
): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const ev of stream) out.push(ev);
  return out;
}

describe('MistralConversationsService', () => {
  let svc: MistralConversationsService;

  beforeEach(() => {
    mockStartStream.mockReset();
    svc = new MistralConversationsService();
  });

  it('requests web_search and maps deltas, tool_reference citations, and usage', async () => {
    mockStartStream.mockReturnValue(
      makeStream([
        {
          data: { type: 'message.output.delta', content: 'Claude Shannon ' },
        },
        {
          data: { type: 'message.output.delta', content: 'was born in 1916.' },
        },
        {
          data: {
            type: 'message.output.delta',
            content: {
              type: 'tool_reference',
              url: 'https://en.wikipedia.org/wiki/Claude_Shannon',
              title: 'Claude Shannon - Wikipedia',
            },
          },
        },
        {
          data: {
            type: 'conversation.response.done',
            usage: { promptTokens: 10, completionTokens: 5 },
          },
        },
      ]),
    );

    const events = await collect(
      svc.streamWithWebSearch(
        [{ role: 'user', content: 'When was Claude Shannon born?' }],
        'mistral-medium-latest',
        'mk-key',
        'Be concise.',
      ),
    );

    // web_search tool requested + system lifted to instructions.
    const req = mockStartStream.mock.calls[0][0] as StartRequest;
    expect(req.tools).toEqual([{ type: 'web_search' }]);
    expect(req.instructions).toBe('Be concise.');
    expect(req.inputs).toEqual([
      { role: 'user', content: 'When was Claude Shannon born?' },
    ]);

    const text = events
      .filter(
        (e): e is { type: 'content'; delta: string } => e.type === 'content',
      )
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('Claude Shannon was born in 1916.');

    expect(events.find((e) => e.type === 'citations')).toEqual({
      type: 'citations',
      citations: [
        {
          url: 'https://en.wikipedia.org/wiki/Claude_Shannon',
          title: 'Claude Shannon - Wikipedia',
        },
      ],
    });

    expect(events.find((e) => e.type === 'usage')).toMatchObject({
      promptTokens: 10,
      completionTokens: 5,
    });
  });

  it('surfaces a conversation error event', async () => {
    mockStartStream.mockReturnValue(
      makeStream([
        { data: { type: 'conversation.response.error', message: 'boom' } },
      ]),
    );
    const events = await collect(
      svc.streamWithWebSearch(
        [{ role: 'user', content: 'hi' }],
        'mistral-medium-latest',
        'mk-key',
      ),
    );
    expect(events).toEqual([{ type: 'error', message: 'boom' }]);
  });
});
