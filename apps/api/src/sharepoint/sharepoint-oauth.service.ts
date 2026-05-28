import {
  BadRequestException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import { oauthConnections } from '@worken/database/schema';

import { ReauthRequiredError } from '../common/errors/reauth-required.error.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { EncryptionService } from '../openrouter/encryption.service.js';

// Re-exported so existing importers (e.g. sharepoint-graph.service.ts)
// can keep their relative path. New code should import from
// '../common/errors/reauth-required.error.js' directly.
export { ReauthRequiredError };

/**
 * Microsoft Graph scope set we request. `Files.Read.All` covers any
 * file the signed-in user has access to (OneDrive + SharePoint).
 * `Sites.Read.All` lets the import dialog list every SharePoint site
 * the user can see. `User.Read` lets us cache the connected account's
 * email for display. `offline_access` is mandatory — without it
 * Microsoft refuses to issue a refresh_token and the connection dies
 * after the first hour.
 *
 * If you change this set, you MUST bump REQUIRED_SCOPES below.
 * Microsoft, like Google, can return a subset of what we asked for
 * (admin policy, conditional consent), and a partial grant should
 * fail fast on the callback rather than silently 401 every Graph
 * call later.
 */
const SHAREPOINT_SCOPES = [
  'Files.Read.All',
  'Sites.Read.All',
  'User.Read',
  'offline_access',
];

const REQUIRED_SCOPES = ['Files.Read.All', 'Sites.Read.All', 'offline_access'];

const PROVIDER = 'sharepoint';

/**
 * Refresh the access token when fewer than this many seconds remain on
 * the current one. 60s matches the Drive integration — Microsoft
 * Graph tokens live for ~1 hour by default, plenty of runway.
 */
const REFRESH_EARLY_MARGIN_SECONDS = 60;

/**
 * State JWT used to bind a Microsoft consent callback back to the
 * user who started it. CSRF protection: without this, a third party
 * could trick a logged-in user into hitting /callback with a code
 * that connects the attacker's SharePoint to the victim's account.
 */
const STATE_TOKEN_TTL_SECONDS = 600; // 10 min — covers consent + multi-step grant

const GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me';

export interface SharePointStatus {
  connected: boolean;
  accountEmail?: string;
  status?: 'active' | 'reauth_required';
  /** Granted scope set. Useful for FE to surface "missing scope" diagnostics. */
  scope?: string;
  lastSyncedAt?: string;
}

interface MicrosoftTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GraphMeResponse {
  mail?: string | null;
  userPrincipalName?: string | null;
}

@Injectable()
export class SharePointOAuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Defensively trim every env value we feed into Microsoft URLs.
   * Stray trailing whitespace on a .env line (e.g. `TENANT_ID=common `
   * pasted from an editor that adds soft-wrap padding) survives into
   * `ConfigService.get` verbatim and corrupts the authorize URL or
   * the redirect_uri parameter — surfacing as AADSTS50011 or a
   * "redirect_uri is not valid" error that's painful to attribute.
   * This helper makes those mistakes impossible.
   */
  private readEnv(key: string, fallback?: string): string {
    const raw = this.config.get<string>(key);
    const trimmed = raw?.trim() ?? fallback ?? '';
    if (!trimmed) {
      if (fallback === undefined) {
        // Mirror ConfigService.getOrThrow's behaviour for required vars.
        throw new Error(`Required env var ${key} is empty`);
      }
      return fallback;
    }
    return trimmed;
  }

  private get tenant(): string {
    // Default to 'common' so multi-tenant + personal Microsoft accounts
    // can sign in without any env tweak. Single-tenant apps override
    // with a GUID in .env; see docs/sharepoint-setup.md.
    return this.readEnv('MICROSOFT_TENANT_ID', 'common');
  }

  private get clientId(): string {
    return this.readEnv('MICROSOFT_CLIENT_ID');
  }

  private get clientSecret(): string {
    return this.readEnv('MICROSOFT_CLIENT_SECRET');
  }

  private get redirectUri(): string {
    return this.readEnv(
      'SHAREPOINT_REDIRECT_URI',
      'http://localhost:3001/sharepoint/callback',
    );
  }

  private get authorizeEndpoint(): string {
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/authorize`;
  }

  private get tokenEndpoint(): string {
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`;
  }

  /**
   * Build the Microsoft consent URL the FE should redirect the user
   * to. `prompt=consent` forces Microsoft to issue a fresh
   * refresh_token even when the user has previously granted offline
   * access for this client — matches the Drive flow's defensive
   * "don't lose offline access on reconnect" guarantee.
   *
   * `state` is a short-lived signed JWT containing the initiating
   * userId; the callback verifies it before persisting any tokens.
   */
  async buildConsentUrl(userId: string): Promise<string> {
    const state = await this.jwt.signAsync(
      { sub: userId, purpose: 'sharepoint-connect' },
      {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: STATE_TOKEN_TTL_SECONDS,
      },
    );

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      response_mode: 'query',
      scope: SHAREPOINT_SCOPES.join(' '),
      state,
      prompt: 'consent',
    });

    return `${this.authorizeEndpoint}?${params.toString()}`;
  }

  /**
   * Exchange a fresh consent code for tokens and persist them under
   * the initiating userId. Replaces an existing connection if the
   * user is reconnecting (unique constraint on (owner_id, provider)).
   *
   * Validates the returned scope set against REQUIRED_SCOPES so a
   * partial grant fails fast on the callback instead of silently
   * 401-ing on every Graph call later.
   */
  async handleCallback(
    code: string,
    state: string,
  ): Promise<{ userId: string }> {
    // Verify the state token first — never act on a callback whose
    // state we didn't sign.
    let userId: string;
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        purpose?: string;
      }>(state, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
      if (payload.purpose !== 'sharepoint-connect') {
        throw new BadRequestException('Invalid OAuth state purpose.');
      }
      userId = payload.sub;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        'OAuth state token is invalid or expired. Restart the connect flow.',
      );
    }

    const tokens = await this.exchangeCodeForTokens(code);

    if (!tokens.access_token) {
      throw new BadRequestException(
        'Microsoft did not return an access token. Try connecting again.',
      );
    }
    if (typeof tokens.expires_in !== 'number') {
      throw new BadRequestException(
        'Microsoft did not return a token expiry. Try connecting again.',
      );
    }

    const grantedScopes = (tokens.scope ?? '').split(/\s+/).filter(Boolean);
    this.assertRequiredScopes(grantedScopes);

    // Pull the connected account's email for the FE status chip.
    // Microsoft Graph returns `mail` for proper mailboxes and falls
    // back to `userPrincipalName` for personal accounts.
    let accountEmail: string | null = null;
    try {
      const me = await this.fetchGraphMe(tokens.access_token);
      accountEmail = me.mail ?? me.userPrincipalName ?? null;
    } catch {
      // swallow — display-only field
    }

    const accessTokenEncrypted = this.encryption.encrypt(tokens.access_token);
    const refreshTokenEncrypted = tokens.refresh_token
      ? this.encryption.encrypt(tokens.refresh_token)
      : null;
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const scopeString = grantedScopes.join(' ');

    // Upsert: one connection per (owner, provider). Reconnect keeps
    // the previous refresh_token if Microsoft omits a new one on this
    // round-trip — defensive guard against losing offline access
    // mid-rotation (rare but observed in the wild).
    const [existing] = await this.db
      .select()
      .from(oauthConnections)
      .where(
        and(
          eq(oauthConnections.ownerId, userId),
          eq(oauthConnections.provider, PROVIDER),
        ),
      );

    if (existing) {
      await this.db
        .update(oauthConnections)
        .set({
          accessTokenEncrypted,
          refreshTokenEncrypted:
            refreshTokenEncrypted ?? existing.refreshTokenEncrypted,
          scope: scopeString,
          expiresAt,
          accountEmail,
          status: 'active',
          updatedAt: new Date(),
        })
        .where(eq(oauthConnections.id, existing.id));
    } else {
      await this.db.insert(oauthConnections).values({
        ownerId: userId,
        provider: PROVIDER,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        scope: scopeString,
        expiresAt,
        accountEmail,
        status: 'active',
      });
    }

    return { userId };
  }

  async getStatus(userId: string): Promise<SharePointStatus> {
    const [row] = await this.db
      .select()
      .from(oauthConnections)
      .where(
        and(
          eq(oauthConnections.ownerId, userId),
          eq(oauthConnections.provider, PROVIDER),
        ),
      );
    if (!row) return { connected: false };
    return {
      connected: true,
      accountEmail: row.accountEmail ?? undefined,
      status: row.status as 'active' | 'reauth_required',
      scope: row.scope,
      lastSyncedAt: row.lastSyncedAt?.toISOString(),
    };
  }

  /**
   * Returns a valid access token for the given user, refreshing first
   * if the stored one is within REFRESH_EARLY_MARGIN_SECONDS of
   * expiry. Used by SharePointGraphService before every Graph call.
   *
   * On refresh failure (revoked grant, no refresh_token, narrowed
   * scopes, …), flips the connection to `status='reauth_required'`
   * and throws ReauthRequiredError. Caller surfaces that as a 401 to
   * the FE, which renders the "Reconnect SharePoint" prompt.
   *
   * IMPORTANT: Microsoft can return a narrower scope set on refresh
   * (admin revokes consent mid-session). We re-verify required
   * scopes against the refresh response and force reauth if anything
   * critical was dropped.
   */
  async getValidAccessToken(userId: string): Promise<string> {
    const [row] = await this.db
      .select()
      .from(oauthConnections)
      .where(
        and(
          eq(oauthConnections.ownerId, userId),
          eq(oauthConnections.provider, PROVIDER),
        ),
      );
    if (!row) {
      throw new ReauthRequiredError('SharePoint is not connected.');
    }
    if (row.status === 'reauth_required') {
      throw new ReauthRequiredError(
        'SharePoint connection needs reauthorization.',
      );
    }

    const nowMs = Date.now();
    const expiresMs = row.expiresAt.getTime();
    const stillFresh = expiresMs - nowMs > REFRESH_EARLY_MARGIN_SECONDS * 1000;
    if (stillFresh) {
      return this.encryption.decrypt(row.accessTokenEncrypted);
    }

    // Refresh path. Without a refresh_token we can't recover.
    if (!row.refreshTokenEncrypted) {
      await this.markReauthRequired(row.id);
      throw new ReauthRequiredError(
        'SharePoint connection has no refresh token. Reconnect to continue.',
      );
    }

    const refreshToken = this.encryption.decrypt(row.refreshTokenEncrypted);

    try {
      const refreshed = await this.refreshTokens(refreshToken);
      if (!refreshed.access_token || typeof refreshed.expires_in !== 'number') {
        await this.markReauthRequired(row.id);
        throw new ReauthRequiredError(
          'Microsoft did not return refreshed credentials. Reconnect to continue.',
        );
      }

      // Re-verify scopes on refresh — see method docstring.
      const grantedScopes = (refreshed.scope ?? row.scope ?? '')
        .split(/\s+/)
        .filter(Boolean);
      try {
        this.assertRequiredScopes(grantedScopes);
      } catch {
        await this.markReauthRequired(row.id);
        throw new ReauthRequiredError(
          'SharePoint permissions were narrowed since you connected. Reconnect to continue.',
        );
      }

      await this.db
        .update(oauthConnections)
        .set({
          accessTokenEncrypted: this.encryption.encrypt(refreshed.access_token),
          expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
          // Microsoft rotates the refresh_token on every refresh —
          // ALWAYS persist the new one. Falling back to the old
          // refresh_token loses the rotation, which is fine until
          // Microsoft eventually invalidates the older one.
          refreshTokenEncrypted: refreshed.refresh_token
            ? this.encryption.encrypt(refreshed.refresh_token)
            : row.refreshTokenEncrypted,
          scope: grantedScopes.join(' '),
          updatedAt: new Date(),
        })
        .where(eq(oauthConnections.id, row.id));
      return refreshed.access_token;
    } catch (err) {
      if (err instanceof ReauthRequiredError) throw err;
      await this.markReauthRequired(row.id);
      throw new ReauthRequiredError(
        'Refreshing the SharePoint token failed. Reconnect to continue.',
      );
    }
  }

  /**
   * Touch lastSyncedAt on the connection. Called after a successful
   * import / re-sync so the FE can show "Synced 5 minutes ago".
   */
  async markSynced(userId: string): Promise<void> {
    await this.db
      .update(oauthConnections)
      .set({ lastSyncedAt: new Date() })
      .where(
        and(
          eq(oauthConnections.ownerId, userId),
          eq(oauthConnections.provider, PROVIDER),
        ),
      );
  }

  /**
   * Drop the connection. Azure has no public v2 revoke endpoint
   * (per docs the user revokes the grant from
   * account.microsoft.com / Entra "My Apps") so we just delete the
   * local row. Sharepoint-import-sources rows cascade away via FK.
   * Imported knowledge_files rows stay — the user removes those via
   * the normal KC delete path.
   */
  async disconnect(userId: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(oauthConnections)
      .where(
        and(
          eq(oauthConnections.ownerId, userId),
          eq(oauthConnections.provider, PROVIDER),
        ),
      );
    if (!row) return;
    await this.db
      .delete(oauthConnections)
      .where(eq(oauthConnections.id, row.id));
  }

  /** Internal accessor for the Graph client. Returns the row (or throws). */
  async requireConnection(userId: string) {
    const [row] = await this.db
      .select()
      .from(oauthConnections)
      .where(
        and(
          eq(oauthConnections.ownerId, userId),
          eq(oauthConnections.provider, PROVIDER),
        ),
      );
    if (!row) throw new ReauthRequiredError('SharePoint is not connected.');
    return row;
  }

  private async markReauthRequired(connectionId: string): Promise<void> {
    await this.db
      .update(oauthConnections)
      .set({ status: 'reauth_required', updatedAt: new Date() })
      .where(eq(oauthConnections.id, connectionId));
  }

  private assertRequiredScopes(grantedScopes: string[]): void {
    // Microsoft sometimes returns scopes with a full URI prefix
    // (e.g. "https://graph.microsoft.com/Files.Read.All") for v1
    // tokens. We compare on the trailing path component so both
    // shapes are accepted.
    const granted = new Set(grantedScopes.map((s) => s.split('/').pop() ?? s));
    const missing = REQUIRED_SCOPES.filter((s) => !granted.has(s));
    if (missing.length > 0) {
      throw new BadRequestException(
        `SharePoint permission missing: ${missing.join(', ')}. Reconnect and accept the requested access.`,
      );
    }
  }

  private async exchangeCodeForTokens(
    code: string,
  ): Promise<MicrosoftTokenResponse> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
      scope: SHAREPOINT_SCOPES.join(' '),
    });

    const res = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const json = (await res.json().catch(() => ({}))) as MicrosoftTokenResponse;
    if (!res.ok || json.error) {
      const detail = json.error_description ?? json.error ?? `${res.status}`;
      throw new BadRequestException(
        `Microsoft token exchange failed: ${detail}`,
      );
    }
    return json;
  }

  private async refreshTokens(
    refreshToken: string,
  ): Promise<MicrosoftTokenResponse> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: SHAREPOINT_SCOPES.join(' '),
    });

    const res = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const json = (await res.json().catch(() => ({}))) as MicrosoftTokenResponse;
    if (!res.ok || json.error) {
      const detail = json.error_description ?? json.error ?? `${res.status}`;
      throw new BadRequestException(
        `Microsoft token refresh failed: ${detail}`,
      );
    }
    return json;
  }

  private async fetchGraphMe(accessToken: string): Promise<GraphMeResponse> {
    const res = await fetch(GRAPH_ME_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Graph /me returned ${res.status}`);
    }
    return (await res.json()) as GraphMeResponse;
  }
}
