import { AnthropicClientService } from './anthropic-client.service.js';
import type { ChatStreamEvent } from '../chat/chat.service.js';

/**
 * Anthropic adapter web-search behavior. The SDK is mocked at the module
 * boundary: `messages.stream` returns a fake async-iterable that yields
 * text deltas and resolves `finalMessage()` to a canned Message. We assert
 * the adapter (a) injects the native `web_search_20250305` tool only when
 * asked, (b) surfaces citations from the final message as a `citations`
 * event, (c) reports `web_search_requests` on the usage event, and (d)
 * resumes the server-side loop on `pause_turn`.
 */
const mockStream = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { stream: mockStream },
  })),
}));

interface FakeMessage {
  stop_reason: string;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    server_tool_use?: { web_search_requests: number } | null;
  };
  content: Array<{
    type: string;
    text?: string;
    citations?: Array<{ type: string; url: string; title: string | null }>;
  }>;
}

function makeStream(
  textDeltas: string[],
  finalMessage: FakeMessage,
): {
  [Symbol.asyncIterator](): AsyncIterator<unknown>;
  finalMessage(): Promise<FakeMessage>;
} {
  return {
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();
      for (const text of textDeltas) {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text },
        };
      }
    },
    finalMessage: () => Promise.resolve(finalMessage),
  };
}

/** Shape of the streaming params we assert on (the mock erases SDK types). */
interface StreamParams {
  tools?: unknown;
  messages: Array<{ role: string }>;
}

async function collect(
  stream: AsyncIterable<ChatStreamEvent>,
): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const ev of stream) out.push(ev);
  return out;
}

describe('AnthropicClientService web search', () => {
  let svc: AnthropicClientService;

  beforeEach(() => {
    mockStream.mockReset();
    svc = new AnthropicClientService();
  });

  it('injects the web_search tool and surfaces citations + search count', async () => {
    mockStream.mockReturnValue(
      makeStream(['Claude Shannon ', 'was born in 1916.'], {
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          server_tool_use: { web_search_requests: 2 },
        },
        content: [
          {
            type: 'text',
            text: 'was born in 1916.',
            citations: [
              {
                type: 'web_search_result_location',
                url: 'https://en.wikipedia.org/wiki/Claude_Shannon',
                title: 'Claude Shannon - Wikipedia',
              },
            ],
          },
        ],
      }),
    );

    const events = await collect(
      svc.sendMessageStream(
        [{ role: 'user', content: 'When was Claude Shannon born?' }],
        'claude-sonnet-4-6',
        'sk-key',
        undefined,
        { webSearch: true },
      ),
    );

    // Tool injected on the request.
    const params = mockStream.mock.calls[0][0] as StreamParams;
    expect(params.tools).toEqual([
      { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
    ]);

    // Text deltas streamed through.
    const text = events
      .filter(
        (e): e is { type: 'content'; delta: string } => e.type === 'content',
      )
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('Claude Shannon was born in 1916.');

    // Citations surfaced once, deduped by URL.
    const citations = events.find((e) => e.type === 'citations');
    expect(citations).toEqual({
      type: 'citations',
      citations: [
        {
          url: 'https://en.wikipedia.org/wiki/Claude_Shannon',
          title: 'Claude Shannon - Wikipedia',
        },
      ],
    });

    // Usage carries the search count for the per-search surcharge.
    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toMatchObject({
      promptTokens: 10,
      completionTokens: 5,
      webSearchRequests: 2,
    });
  });

  it('omits the tool and the search count when web search is off', async () => {
    mockStream.mockReturnValue(
      makeStream(['Hi there.'], {
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 2, server_tool_use: null },
        content: [{ type: 'text', text: 'Hi there.' }],
      }),
    );

    const events = await collect(
      svc.sendMessageStream(
        [{ role: 'user', content: 'hi' }],
        'claude-sonnet-4-6',
        'sk-key',
      ),
    );

    expect((mockStream.mock.calls[0][0] as StreamParams).tools).toBeUndefined();
    expect(events.find((e) => e.type === 'citations')).toBeUndefined();
    const usage = events.find((e) => e.type === 'usage');
    expect(usage).not.toHaveProperty('webSearchRequests');
  });

  it('resumes the server-side loop on pause_turn and sums usage', async () => {
    mockStream
      .mockReturnValueOnce(
        makeStream(['Searching… '], {
          stop_reason: 'pause_turn',
          usage: {
            input_tokens: 10,
            output_tokens: 4,
            server_tool_use: { web_search_requests: 1 },
          },
          content: [{ type: 'text', text: 'Searching… ' }],
        }),
      )
      .mockReturnValueOnce(
        makeStream(['done.'], {
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 20,
            output_tokens: 6,
            server_tool_use: { web_search_requests: 1 },
          },
          content: [{ type: 'text', text: 'done.' }],
        }),
      );

    const events = await collect(
      svc.sendMessageStream(
        [{ role: 'user', content: 'research this' }],
        'claude-opus-4-7',
        'sk-key',
        undefined,
        { webSearch: true },
      ),
    );

    // Two upstream calls: the initial request and the pause_turn resume.
    expect(mockStream).toHaveBeenCalledTimes(2);
    // The resume appends the assistant turn produced so far.
    const resumeMessages = (mockStream.mock.calls[1][0] as StreamParams)
      .messages;
    expect(resumeMessages[resumeMessages.length - 1].role).toBe('assistant');

    // Usage summed across both billed passes.
    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toMatchObject({
      promptTokens: 30,
      completionTokens: 10,
      webSearchRequests: 2,
    });
  });
});
