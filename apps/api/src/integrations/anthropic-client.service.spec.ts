import type { ChatStreamEvent } from '../chat/chat.service.js';

// Mock the Anthropic SDK so the tool-loop tests can drive the
// `messages.stream` shape (text deltas + a final message with tool_use
// blocks) without a real SDK, key, or network. `mock`-prefixed names are
// referenced from the hoisted factory, which jest permits.
const mockStream = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: class MockAnthropic {
    messages = { stream: mockStream };
    constructor(_opts: unknown) {
      void _opts;
    }
  },
}));

import { AnthropicClientService } from './anthropic-client.service.js';

/** A fake MessageStream: async-iterable over text deltas + finalMessage(). */
function fakeStream(deltas: string[], final: unknown) {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await -- generator stub
    [Symbol.asyncIterator]: async function* () {
      for (const text of deltas) {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text },
        };
      }
    },
    finalMessage: () => Promise.resolve(final),
  };
}

async function collect(stream: AsyncIterable<ChatStreamEvent>) {
  const out: ChatStreamEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

const WEATHER_TOOL = {
  name: 'arso_weather_forecast',
  description: 'weather',
  parameters: { type: 'object', properties: { location: { type: 'string' } } },
};

describe('AnthropicClientService.sendMessageStream — native tool_use loop', () => {
  beforeEach(() => mockStream.mockReset());

  it('runs the agentic loop: tool_use → run tool → re-call with the result', async () => {
    // Round 1: model emits a preamble + a tool_use block, stops for tools.
    mockStream.mockReturnValueOnce(
      fakeStream(['Let me check. '], {
        content: [
          { type: 'text', text: 'Let me check. ' },
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'arso_weather_forecast',
            input: { location: 'Ljubljana' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );
    // Round 2: with the tool result in context, the model answers.
    mockStream.mockReturnValueOnce(
      fakeStream(['It is 25°C.'], {
        content: [{ type: 'text', text: 'It is 25°C.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 8 },
      }),
    );

    const runTool = jest.fn().mockResolvedValue({ tempC: 25 });
    const svc = new AnthropicClientService();
    const events = await collect(
      svc.sendMessageStream(
        [{ role: 'user', content: 'vreme v Ljubljani?' }],
        'claude-haiku-4-5',
        'fake-key',
        undefined,
        { tools: [WEATHER_TOOL], runTool, maxToolIters: 5 },
      ),
    );

    // Tool was dispatched with the model's parsed args.
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledWith('arso_weather_forecast', {
      location: 'Ljubljana',
    });

    // The model was re-called once with the result appended.
    expect(mockStream).toHaveBeenCalledTimes(2);
    const secondCallMessages = mockStream.mock.calls[1][0].messages;
    expect(secondCallMessages).toHaveLength(3); // user, assistant(tool_use), user(tool_result)
    expect(secondCallMessages[1].role).toBe('assistant');
    expect(secondCallMessages[2].content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'tu_1',
    });

    // Event stream: content from both rounds, a tool_call/tool_result pair,
    // and a single summed usage event at the end.
    const toolCall = events.find((e) => e.type === 'tool_call');
    expect(toolCall).toMatchObject({
      id: 'tu_1',
      name: 'arso_weather_forecast',
      arguments: { location: 'Ljubljana' },
    });
    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult).toMatchObject({ id: 'tu_1', ok: true });

    const contents = events
      .filter((e) => e.type === 'content')
      .map((e) => (e as { delta: string }).delta)
      .join('');
    expect(contents).toBe('Let me check. It is 25°C.');

    const usage = events.filter((e) => e.type === 'usage');
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      promptTokens: 30,
      completionTokens: 13,
      totalTokens: 43,
    });
  });

  it('marks a failed tool with is_error and ok:false but keeps going', async () => {
    mockStream.mockReturnValueOnce(
      fakeStream([], {
        content: [
          {
            type: 'tool_use',
            id: 'tu_x',
            name: 'arso_weather_forecast',
            input: { location: 'Nowhere' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 4, output_tokens: 2 },
      }),
    );
    mockStream.mockReturnValueOnce(
      fakeStream(['Sorry, no data.'], {
        content: [{ type: 'text', text: 'Sorry, no data.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 6, output_tokens: 3 },
      }),
    );

    const runTool = jest.fn().mockRejectedValue(new Error('ARSO down'));
    const svc = new AnthropicClientService();
    const events = await collect(
      svc.sendMessageStream(
        [{ role: 'user', content: 'vreme?' }],
        'claude-haiku-4-5',
        'fake-key',
        undefined,
        { tools: [WEATHER_TOOL], runTool },
      ),
    );

    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult).toMatchObject({ ok: false });
    const resultBlock = mockStream.mock.calls[1][0].messages[2].content[0];
    expect(resultBlock).toMatchObject({ tool_use_id: 'tu_x', is_error: true });
  });

  it('without tools, streams once (no loop, behaviour unchanged)', async () => {
    mockStream.mockReturnValueOnce(
      fakeStream(['Hi ', 'there'], {
        content: [{ type: 'text', text: 'Hi there' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 2 },
      }),
    );

    const svc = new AnthropicClientService();
    const events = await collect(
      svc.sendMessageStream(
        [{ role: 'user', content: 'hi' }],
        'claude-haiku-4-5',
        'fake-key',
      ),
    );

    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.type === 'tool_call')).toHaveLength(0);
    expect(
      events
        .filter((e) => e.type === 'content')
        .map((e) => (e as { delta: string }).delta)
        .join(''),
    ).toBe('Hi there');
    expect(events.filter((e) => e.type === 'usage')).toHaveLength(1);
  });
});
