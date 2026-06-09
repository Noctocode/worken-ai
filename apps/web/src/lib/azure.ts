/**
 * Client-side Azure OpenAI endpoint validation.
 *
 * Source of truth lives server-side in
 * `apps/api/src/integrations/azure-validation.ts` (`AZURE_HOST_SUFFIXES`
 * / `parseAzureConfig`) — the FE can't import across the app boundary,
 * so this mirrors the host allowlist. Keep the two in sync: a new
 * sovereign cloud added there must be added here, or the form will
 * reject endpoints the BE would accept.
 *
 * Used by the Integration settings dialog and the onboarding step-5
 * wizard so both forms gate "Save"/"Continue" on the same rule and a
 * non-Azure URL never reaches the BE only to be silently dropped.
 */

const AZURE_HOST_SUFFIXES = [
  ".openai.azure.com",
  ".openai.azure.us", // Azure Government
  ".openai.azure.cn", // Azure operated by 21Vianet (China)
];

/** True when `hostname` is a subdomain of an Azure OpenAI host. */
export function isAzureEndpointHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return AZURE_HOST_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

/** True when `endpoint` is an https URL on an Azure OpenAI host. */
export function isValidAzureEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint.trim());
    return u.protocol === "https:" && isAzureEndpointHost(u.hostname);
  } catch {
    return false;
  }
}
