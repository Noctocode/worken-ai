/**
 * Shared Azure OpenAI config validation, used by both the integrations
 * upsert/PATCH path and onboarding. Kept in one place so the SSRF host
 * allowlist and the deployment-name charset rule can't drift between
 * the two entry points.
 */

/**
 * Azure OpenAI endpoint host suffixes — public cloud + sovereign
 * clouds. The endpoint must be a subdomain of one of these. A bare
 * `protocol === 'https:'` check would accept internal hosts
 * (`https://169.254.169.254/`, `https://localhost/`, …) and turn the
 * server-side AzureOpenAI client into an SSRF vector.
 */
const AZURE_HOST_SUFFIXES = [
  '.openai.azure.com',
  '.openai.azure.us', // Azure Government
  '.openai.azure.cn', // Azure operated by 21Vianet (China)
] as const;

/** True when `hostname` is a subdomain of an Azure OpenAI host. */
export function isAzureEndpointHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return AZURE_HOST_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

/**
 * Allowed Azure deployment-name characters. The name is interpolated
 * into the request URL path (`…/openai/deployments/{name}`) and into
 * the synthesized model id `azure/<name>` (split on `/` during
 * provider resolution), so anything outside this set could corrupt the
 * URL or mis-parse the provider.
 */
export const AZURE_DEPLOYMENT_NAME_RE = /^[A-Za-z0-9_-]+$/;
