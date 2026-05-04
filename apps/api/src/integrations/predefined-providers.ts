/**
 * Catalog of predefined LLM providers exposed in Management → Integration.
 *
 * Each entry is the canonical list of every provider the UI cards can
 * show. Order is preserved when surfacing the grid to the FE. Keep this
 * file the single source of truth — the FE fetches it via
 * GET /integrations/providers and renders cards from the response, so a
 * new provider only needs an entry here (and a matching icon component
 * on the FE side).
 *
 * `id` is what we store in `integrations.provider_id`. Use stable
 * lower-case strings, ideally matching the OpenRouter provider slug so
 * we can correlate with `observability_events.provider` for stats.
 */
import { NATIVE_ENDPOINTS, isByokSupported } from './native-endpoints.js';

export interface PredefinedProvider {
  id: string;
  displayName: string;
  description: string;
  /**
   * Hint for the FE icon mapping. Identifier the FE switches on to pick
   * the right SVG component.
   */
  iconHint: string;
  /**
   * Whether the provider's native API speaks OpenAI Chat Completions
   * verbatim. Factual flag — never changes per-deploy.
   */
  openAICompatible: boolean;
  /**
   * Whether we can honour a BYOK key end-to-end (either via OpenAI SDK
   * with a custom baseURL, or via a native SDK shim). When false, the
   * key is stored but chat falls back to OpenRouter and the Settings
   * dialog shows a disclaimer.
   */
  byokSupported: boolean;
}

const PROVIDERS_RAW: Omit<
  PredefinedProvider,
  'openAICompatible' | 'byokSupported'
>[] = [
  {
    id: 'google',
    displayName: 'Gemini',
    description: "Google's flagship models — Gemini Pro, Flash.",
    iconHint: 'gemini',
  },
  {
    id: 'openai',
    displayName: 'Chat GPT',
    description: "OpenAI's GPT family — GPT-4, GPT-5, mini variants.",
    iconHint: 'chatgpt',
  },
  {
    id: 'deepseek',
    displayName: 'Deepseek',
    description: 'Deepseek V4 family — fast and inexpensive.',
    iconHint: 'deepseek',
  },
  {
    id: 'mistralai',
    displayName: 'Mistral',
    description: 'Mistral / Codestral / Mixtral open-weight family.',
    iconHint: 'mistral',
  },
  {
    id: 'anthropic',
    displayName: 'Claude',
    description: "Anthropic's Claude — Sonnet, Opus, Haiku.",
    iconHint: 'claude',
  },
  {
    id: 'perplexity',
    displayName: 'Preplexity',
    description: 'Perplexity Sonar — search-augmented chat.',
    iconHint: 'perplexity',
  },
  {
    id: 'qwen',
    displayName: 'Qwen',
    description: 'Alibaba Qwen 3 family — open-weight strong code support.',
    iconHint: 'qwen',
  },
  {
    id: 'github',
    displayName: 'Copilot',
    description: 'GitHub Copilot models for code-heavy workflows.',
    iconHint: 'copilot',
  },
  {
    id: 'x-ai',
    displayName: 'Grok',
    description: "xAI's Grok models.",
    iconHint: 'grok',
  },
];

export const PREDEFINED_PROVIDERS: PredefinedProvider[] = PROVIDERS_RAW.map(
  (p) => ({
    ...p,
    openAICompatible: NATIVE_ENDPOINTS[p.id]?.openAICompatible ?? false,
    byokSupported: isByokSupported(p.id),
  }),
);

export function isPredefinedProvider(id: string): boolean {
  return PREDEFINED_PROVIDERS.some((p) => p.id === id);
}
