import {
  GeminiClientService,
  isGeminiNativeSupported,
} from './gemini-client.service.js';
import type { ChatStreamEvent } from '../chat/chat.service.js';

/**
 * Gemini adapter web-search behavior. The SDK is mocked at the module
 * boundary: `models.generateContentStream` resolves to a fake async
 * generator of response chunks. We assert the adapter (a) injects the
 * native `googleSearch` grounding tool only when asked, (b) surfaces
 * grounding web sources as a `citations` event, and (c) reports
 * `webSearchRequests: 1` on a grounded turn for the surcharge.
 */
const mockGenerateContentStream = jest.fn();
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContentStream: mockGenerateContentStream },
  })),
}));

interface FakeChunk {
  text?: string;
  candidates?: Array<{
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

function makeStream(chunks: FakeChunk[]): Promise<AsyncGenerator<FakeChunk>> {
  async function* gen(): AsyncGenerator<FakeChunk> {
    await Promise.resolve();
    for (const c of chunks) yield c;
  }
  return Promise.resolve(gen());
}

interface StreamParams {
  model: string;
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  config?: { tools?: unknown; systemInstruction?: string };
}

async function collect(
  stream: AsyncIterable<ChatStreamEvent>,
): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const ev of stream) out.push(ev);
  return out;
}

describe('isGeminiNativeSupported', () => {
  const cases: Array<[string, boolean]> = [
    ['google/gemini-2.5-pro', true],
    ['google/gemini-2.0-flash-001', true],
    ['google/gemini-3-pro-preview', true],
    ['gemini-2.5-flash', true],
    // 1.x slugs reorder the native name → skip native, fall back to managed.
    ['google/gemini-flash-1.5', false],
    ['google/gemini-pro-1.5', false],
    // Non-Gemini Google models have no native grounding route here.
    ['google/gemma-3-27b-it', false],
    ['google/learnlm-2.0-flash', false],
  ];
  it.each(cases)('%s → %s', (id, expected) => {
    expect(isGeminiNativeSupported(id)).toBe(expected);
  });
});

describe('GeminiClientService web search', () => {
  let svc: GeminiClientService;

  beforeEach(() => {
    mockGenerateContentStream.mockReset();
    svc = new GeminiClientService();
  });

  it('injects the googleSearch tool and surfaces grounding citations', async () => {
    mockGenerateContentStream.mockReturnValue(
      makeStream([
        { text: 'Claude Shannon ' },
        {
          text: 'was born in 1916.',
          candidates: [
            {
              groundingMetadata: {
                groundingChunks: [
                  {
                    web: {
                      uri: 'https://en.wikipedia.org/wiki/Claude_Shannon',
                      title: 'Claude Shannon - Wikipedia',
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        },
      ]),
    );

    const events = await collect(
      svc.sendMessageStream(
        [{ role: 'user', content: 'When was Claude Shannon born?' }],
        'gemini-2.5-pro',
        'AIza-key',
        undefined,
        { webSearch: true },
      ),
    );

    // Tool injected on the request config.
    const params = mockGenerateContentStream.mock.calls[0][0] as StreamParams;
    expect(params.config?.tools).toEqual([{ googleSearch: {} }]);

    // Text deltas streamed through.
    const text = events
      .filter(
        (e): e is { type: 'content'; delta: string } => e.type === 'content',
      )
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('Claude Shannon was born in 1916.');

    // Grounding sources surfaced once as citations.
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

    // A grounded turn counts as one search for the surcharge.
    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toMatchObject({
      promptTokens: 10,
      completionTokens: 5,
      webSearchRequests: 1,
    });
  });

  it('omits the tool and the search count when web search is off', async () => {
    mockGenerateContentStream.mockReturnValue(
      makeStream([
        {
          text: 'Hi there.',
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
        },
      ]),
    );

    const events = await collect(
      svc.sendMessageStream(
        [{ role: 'user', content: 'hi' }],
        'gemini-2.5-flash',
        'AIza-key',
      ),
    );

    const params = mockGenerateContentStream.mock.calls[0][0] as StreamParams;
    expect(params.config?.tools).toBeUndefined();
    expect(events.find((e) => e.type === 'citations')).toBeUndefined();
    const usage = events.find((e) => e.type === 'usage');
    expect(usage).not.toHaveProperty('webSearchRequests');
  });

  it('maps the assistant role to "model" and lifts system to systemInstruction', async () => {
    mockGenerateContentStream.mockReturnValue(makeStream([{ text: 'ok' }]));

    await collect(
      svc.sendMessageStream(
        [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
          { role: 'user', content: 'continue' },
        ],
        'gemini-2.5-pro',
        'AIza-key',
        'You are helpful.',
      ),
    );

    const params = mockGenerateContentStream.mock.calls[0][0] as StreamParams;
    expect(params.config?.systemInstruction).toBe('You are helpful.');
    expect(params.contents.map((c) => c.role)).toEqual([
      'user',
      'model',
      'user',
    ]);
  });
});
