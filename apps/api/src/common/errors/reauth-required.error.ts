import { UnauthorizedException } from '@nestjs/common';

/**
 * Provider-agnostic "this OAuth connection can't reach the upstream
 * API anymore — the user needs to reconnect" signal. Surfaced as a
 * 401 by Nest's exception filter; the FE renders a "Reconnect …"
 * prompt for the relevant integration.
 *
 * Thrown by every OAuth service's `getValidAccessToken` (and the
 * downstream API client wrappers) when:
 *   - The connection row's `status` is already `'reauth_required'`
 *     (a previous refresh failed).
 *   - The stored refresh_token is missing or rejected by the
 *     upstream IdP.
 *   - The upstream returns a narrowed scope set on refresh
 *     (admin revoked consent mid-session).
 *
 * Callers pass a provider-specific message at construction so the
 * FE toast can be precise ("Reconnect Google Drive" vs "Reconnect
 * SharePoint"). The no-arg default is intentionally generic —
 * always prefer the explicit form when the provider is known.
 */
export class ReauthRequiredError extends UnauthorizedException {
  constructor(message = 'OAuth connection needs reauthorization.') {
    super(message);
  }
}
