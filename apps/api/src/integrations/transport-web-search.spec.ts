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
 * (any openrouter route) and the native BYOK tools — Anthropic
 * (anthropic-sdk) and Gemini (gemini-sdk). Everything else is off.
 */
describe('transportSupportsWebSearch', () => {
  const cases: Array<[ChatRoutingSource, ChatTransportKind, boolean]> = [
    // OpenRouter web plugin — regardless of SDK kind.
    ['openrouter', 'openai-sdk', true],
    // Native BYOK tools: Anthropic web_search, Gemini googleSearch.
    ['byok', 'anthropic-sdk', true],
    ['byok', 'gemini-sdk', true],
    // Other BYOK routes have no web-search path.
    ['byok', 'openai-sdk', false],
    ['byok', 'azure-sdk', false],
    // Custom OpenAI-compatible endpoints: no path either.
    ['custom', 'openai-sdk', false],
    // Native kinds only count on the byok route, never custom.
    ['custom', 'anthropic-sdk', false],
    ['custom', 'gemini-sdk', false],
  ];

  it.each(cases)('source=%s kind=%s → %s', (source, kind, expected) => {
    expect(transportSupportsWebSearch(source, kind)).toBe(expected);
  });
});
