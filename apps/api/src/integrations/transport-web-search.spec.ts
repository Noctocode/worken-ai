import { transportSupportsWebSearch } from './chat-transport.service.js';
import type {
  ChatRoutingSource,
  ChatTransportKind,
} from './chat-transport.service.js';

/**
 * Freezes which resolved transports can do web search. The same rule
 * gates the chat hot path, the per-candidate fallback re-gate, the cron
 * runner, and the FE `webSearchSupported` flag — so the decision lives in
 * one pure function tested here. Three mechanisms: the OpenRouter web plugin
 * (any openrouter route), Anthropic's native server-side tool (byok +
 * anthropic-sdk), and direct-OpenAI's Responses web_search tool (byok +
 * openai-sdk + provider 'openai'). Everything else is off.
 */
describe('transportSupportsWebSearch', () => {
  const cases: Array<
    [ChatRoutingSource, ChatTransportKind, string | undefined, boolean]
  > = [
    // OpenRouter web plugin — regardless of SDK kind / provider.
    ['openrouter', 'openai-sdk', 'openai', true],
    // Anthropic BYOK native web_search tool.
    ['byok', 'anthropic-sdk', 'anthropic', true],
    // Direct-OpenAI BYOK Responses web_search tool.
    ['byok', 'openai-sdk', 'openai', true],
    // OpenAI-compatible BYOK providers that aren't OpenAI: no path.
    ['byok', 'openai-sdk', 'deepseek', false],
    ['byok', 'openai-sdk', undefined, false],
    // Azure is excluded: it resolves to azure-sdk / provider 'azure', so the
    // openai-sdk + 'openai' conjunction never matches it.
    ['byok', 'azure-sdk', 'azure', false],
    ['byok', 'azure-sdk', 'openai', false],
    // Custom OpenAI-compatible endpoints: no path even with provider 'openai'.
    ['custom', 'openai-sdk', 'openai', false],
    // anthropic-sdk only counts on the byok route, never custom.
    ['custom', 'anthropic-sdk', 'anthropic', false],
  ];

  it.each(cases)(
    'source=%s kind=%s provider=%s → %s',
    (source, kind, provider, expected) => {
      expect(transportSupportsWebSearch(source, kind, provider)).toBe(expected);
    },
  );
});
