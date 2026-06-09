/**
 * Shared Azure OpenAI config validation, used by both the integrations
 * upsert/PATCH path and onboarding. Kept in one place so the SSRF host
 * allowlist and the deployment-name charset rule can't drift between
 * the two entry points.
 */

import type { IntegrationConfig } from '@worken/database/schema';

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

/**
 * Result of validating + normalizing an Azure config. Pure (no Nest
 * deps) so both entry points share ONE rule set and only differ in how
 * they react: the integrations PATCH throws `BadRequestException(reason)`,
 * onboarding drops the key on `!ok`. Keeps the SSRF host allowlist and
 * the deployment charset from drifting between the two.
 */
export type AzureConfigParse =
  | { ok: true; config: IntegrationConfig }
  | { ok: false; reason: string };

/** Validate + normalize an Azure integration config (endpoint host,
 *  https, api-version, ≥1 charset-valid deployment; trailing slash
 *  stripped). Returns a discriminated result — callers choose throw vs
 *  drop. */
export function parseAzureConfig(
  config: IntegrationConfig | undefined,
): AzureConfigParse {
  const endpoint = config?.azureEndpoint?.trim();
  const apiVersion = config?.azureApiVersion?.trim();
  const deployments = config?.azureDeployments ?? [];
  if (!endpoint) {
    return { ok: false, reason: 'Azure OpenAI requires a resource endpoint' };
  }
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:') throw new Error('not https');
    if (!isAzureEndpointHost(u.hostname)) throw new Error('not azure host');
  } catch {
    return {
      ok: false,
      reason: 'Azure endpoint must be an https URL on *.openai.azure.com',
    };
  }
  if (!apiVersion) {
    return { ok: false, reason: 'Azure OpenAI requires an api-version' };
  }
  const cleanDeployments = deployments
    .map((d) => ({
      deploymentName: d?.deploymentName?.trim() ?? '',
      label: d?.label?.trim() || d?.deploymentName?.trim() || '',
    }))
    .filter((d) => d.deploymentName);
  if (cleanDeployments.length === 0) {
    return {
      ok: false,
      reason: 'Azure OpenAI requires at least one deployment',
    };
  }
  const bad = cleanDeployments.find(
    (d) => !AZURE_DEPLOYMENT_NAME_RE.test(d.deploymentName),
  );
  if (bad) {
    return {
      ok: false,
      reason: `Invalid Azure deployment name "${bad.deploymentName}" — use letters, digits, '-' or '_' only.`,
    };
  }
  return {
    ok: true,
    config: {
      azureEndpoint: endpoint.replace(/\/+$/, ''),
      azureApiVersion: apiVersion,
      azureDeployments: cleanDeployments,
    },
  };
}
