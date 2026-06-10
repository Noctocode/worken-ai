/**
 * Fallback display label for a Custom LLM integration that has no bound
 * alias name yet: the endpoint URL's hostname (e.g. "prod2.noctocode.dev"),
 * or "Custom LLM" if the URL can't be parsed.
 *
 * Shared by integrations.service (the Integration tab) and teams.service
 * (the team "AI Provider Keys" lists) so the two surfaces label a keyless
 * Custom LLM identically. Both prefer the bound alias's customName and only
 * fall back to this.
 */
export function deriveCustomDisplayName(url: string): string {
  try {
    return new URL(url).hostname || 'Custom LLM';
  } catch {
    return 'Custom LLM';
  }
}
