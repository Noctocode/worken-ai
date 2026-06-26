import { transportSupportsWebSearch } from './chat-transport.service.js';
import type {
  ChatRoutingSource,
  ChatTransportKind,
} from './chat-transport.service.js';

/**
 * Freezes which resolved transports can do web search. The same rule
 * gates the chat hot path, the per-candidate fallback re-gate, the cron
 * runner, and the FE `webSearchSupported` flag — so the decision lives in
 * one pure function tested here. Mechanisms: the OpenRouter web plugin
 * (any openrouter route), Anthropic's native tool (byok + anthropic-sdk),
 * and Perplexity sonar's built-in search (byok + openai-sdk + provider
 * 'perplexity'). Everything else is off.
 */
describe('transportSupportsWebSearch', () => {
  const cases: Array<
    [ChatRoutingSource, ChatTransportKind, string | undefined, boolean]
  > = [
    // OpenRouter web plugin — regardless of SDK kind / provider.
    ['openrouter', 'openai-sdk', 'openai', true],
    ['openrouter', 'openai-sdk', 'perplexity', true],
    // Anthropic BYOK native web_search tool.
    ['byok', 'anthropic-sdk', 'anthropic', true],
    // Perplexity BYOK — sonar searches by default.
    ['byok', 'openai-sdk', 'perplexity', true],
    // Other openai-sdk BYOK providers have no native search.
    ['byok', 'openai-sdk', 'openai', false],
    ['byok', 'openai-sdk', 'deepseek', false],
    ['byok', 'openai-sdk', undefined, false],
    ['byok', 'azure-sdk', 'azure', false],
    // Custom OpenAI-compatible endpoints: no path even for perplexity.
    ['custom', 'openai-sdk', 'perplexity', false],
    ['custom', 'anthropic-sdk', 'anthropic', false],
  ];

  it.each(cases)(
    'source=%s kind=%s provider=%s → %s',
    (source, kind, provider, expected) => {
      expect(transportSupportsWebSearch(source, kind, provider)).toBe(expected);
    },
  );
});
