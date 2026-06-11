import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import { oauthConnections } from '@worken/database/schema';

import { ReauthRequiredError } from '../common/errors/reauth-required.error.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { EncryptionService } from '../openrouter/encryption.service.js';

// Re-exported so the client service can keep importing from here, mirroring
// the google-drive module layout. New code should import from
// '../common/errors/reauth-required.error.js' directly.
export { ReauthRequiredError };

/**
 * Atlassian 3LO (OAuth 2.0) endpoints. Unlike Google we hit the auth /
 * token hosts directly via `fetch` — there is no first-party SDK in the
 * api package and the flow is a plain code-exchange + rotating-refresh.
 */
const ATLASSIAN_AUTHORIZE_URL = 'https://auth.atlassian.com/authorize';
const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
/** Identity endpoint — used to cache the connected account's email. */
const ATLASSIAN_ME_URL = 'https://api.atlassian.com/me';

/**
 * Scope set we request. `offline_access` is what makes Atlassian return a
 * refresh_token (without it the connection dies after one hour with no way
 * to recover but a full reconnect). The two `read:confluence-*` scopes
 * cover listing spaces + reading page bodies, which is everything the
 * import path needs.
 *
 * If you change this set, bump REQUIRED_SCOPES below — Atlassian can grant
 * a subset and we want to reject a partial grant up-front rather than
 * 403-ing on every Confluence call later.
 */
const CONFLUENCE_SCOPES = [
  'read:confluence-space.summary',
  'read:confluence-content.all',
  'read:confluence-content.summary',
  'read:me',
  'offline_access',
];

const REQUIRED_SCOPES = [
  'read:confluence-space.summary',
  'read:confluence-content.all',
];

const PROVIDER = 'confluence';

/**
 * Refresh the access token when fewer than this many seconds remain. 60s
 * gives a typical Confluence API call enough runway to land before the
 * token would have expired mid-flight.
 */
const REFRESH_EARLY_MARGIN_SECONDS = 60;

/**
 * State JWT TTL. Binds the Atlassian consent callback back to the user who
 * started it (CSRF guard); single-use through the short expiry.
 */
const STATE_TOKEN_TTL_SECONDS = 600; // 10 min — covers consent + grant

export interface ConfluenceStatus {
  connected: boolean;
  accountEmail?: string;
  status?: 'active' | 'reauth_required';
  /** Granted scope set. Lets the FE surface a "missing scope" diagnostic. */
  scope?: string;
  lastSyncedAt?: string;
}

interface AtlassianTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

@Injectable()
export class ConfluenceOAuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Per-user single-flight guard for token resolution. Coalesces concurrent
   * `getValidAccessToken` calls so only one refresh runs at a time per user —
   * see the method docstring for why the rotating refresh token makes this
   * necessary.
   */
  private readonly tokenInFlight = new Map<string, Promise<string>>();

  private redirectUri(): string {
    return this.config.get<string>(
      'CONFLUENCE_REDIRECT_URI',
      'http://localhost:3001/confluence/callback',
    );
  }

  /**
   * Build the Atlassian consent URL the FE should redirect to.
   *
   * `audience=api.atlassian.com` is mandatory for 3LO — it scopes the
   * resulting token to the Atlassian REST gateway. `prompt=consent` forces
   * a fresh refresh_token on every connect (mirrors the Google Drive flow)
   * so a reconnect of a previously-disconnected site can still refresh an
   * hour later. `state` is a short-lived signed JWT carrying the initiating
   * userId, verified in the callback.
   */
  async buildConsentUrl(userId: string): Promise<string> {
    const state = await this.jwt.signAsync(
      { sub: userId, purpose: 'confluence-connect' },
      {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: STATE_TOKEN_TTL_SECONDS,
      },
    );

    const params = new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: this.config.getOrThrow<string>('CONFLUENCE_CLIENT_ID'),
      scope: CONFLUENCE_SCOPES.join(' '),
      redirect_uri: this.redirectUri(),
      state,
      response_type: 'code',
      prompt: 'consent',
    });
    return `${ATLASSIAN_AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * Exchange a fresh consent code for tokens and persist them under the
   * initiating userId. Replaces an existing connection on reconnect (unique
   * constraint on (owner_id, provider)). Validates the granted scope set so
   * a partial grant is rejected up-front instead of 403-ing later.
   */
  async handleCallback(
    code: string,
    state: string,
  ): Promise<{ userId: string }> {
    let userId: string;
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        purpose?: string;
      }>(state, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
      if (payload.purpose !== 'confluence-connect') {
        throw new BadRequestException('Invalid OAuth state purpose.');
      }
      userId = payload.sub;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        'OAuth state token is invalid or expired. Restart the connect flow.',
      );
    }

    const tokens = await this.exchangeCode(code);
    if (!tokens.access_token) {
      throw new BadRequestException(
        'Atlassian did not return an access token. Try connecting again.',
      );
    }
    if (!tokens.expires_in) {
      throw new BadRequestException(
        'Atlassian did not return a token expiry. Try connecting again.',
      );
    }

    const grantedScopes = (tokens.scope ?? '').split(/\s+/).filter(Boolean);
    const missing = REQUIRED_SCOPES.filter((s) => !grantedScopes.includes(s));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Confluence permission missing: ${missing.join(', ')}. Reconnect and accept the requested access.`,
      );
    }

    // Best-effort fetch of the connected account email for the FE chip.
    let accountEmail: string | null = null;
    try {
      const meRes = await fetch(ATLASSIAN_ME_URL, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: 'application/json',
        },
      });
      if (meRes.ok) {
        const me = (await meRes.json()) as { email?: string };
        accountEmail = me.email ?? null;
      }
    } catch {
      // swallow — display-only field
    }

    const accessTokenEncrypted = this.encryption.encrypt(tokens.access_token);
    const refreshTokenEncrypted = tokens.refresh_token
      ? this.encryption.encrypt(tokens.refresh_token)
      : null;
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const scopeString = grantedScopes.join(' ');

    // Upsert: one connection per (owner, provider). On reconnect keep the
    // previous refresh_token if Atlassian omits a new one (it shouldn't with
    // prompt=consent, but guard against losing offline access regardless).
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

  async getStatus(userId: string): Promise<ConfluenceStatus> {
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
   * Return a valid access token for the user, refreshing first if the stored
   * one is within REFRESH_EARLY_MARGIN_SECONDS of expiry. Atlassian rotates —
   * and immediately invalidates — the refresh_token on every refresh, so we
   * persist the new one.
   *
   * Concurrent callers for the same user are coalesced through one in-flight
   * promise (`tokenInFlight`). Without it, two overlapping calls (e.g. a
   * browse request landing during an import) could both decide to refresh:
   * the first rotates the token, the second then presents the now-dead one,
   * fails, and needlessly flips the connection to `reauth_required`. The
   * map check-and-set is synchronous (no await between get and set), so
   * exactly one `resolveValidAccessToken` runs per user and everyone shares
   * its result. This is per-process; a multi-instance deploy would still need
   * a distributed lock, but the 60s proactive-refresh margin keeps that
   * cross-instance window tiny.
   */
  getValidAccessToken(userId: string): Promise<string> {
    const existing = this.tokenInFlight.get(userId);
    if (existing) return existing;
    const inFlight = this.resolveValidAccessToken(userId).finally(() => {
      this.tokenInFlight.delete(userId);
    });
    this.tokenInFlight.set(userId, inFlight);
    return inFlight;
  }

  /**
   * Actual token resolution (select → check freshness → refresh if needed).
   * Always invoked through `getValidAccessToken`'s single-flight wrapper, so
   * at most one of these runs per user at a time. On refresh failure flips
   * the connection to `status='reauth_required'` and throws
   * `ReauthRequiredError`, which the caller surfaces as a 401 → FE "Reconnect
   * Confluence" prompt.
   */
  private async resolveValidAccessToken(userId: string): Promise<string> {
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
      throw new ReauthRequiredError('Confluence is not connected.');
    }
    if (row.status === 'reauth_required') {
      throw new ReauthRequiredError(
        'Confluence connection needs reauthorization.',
      );
    }

    const stillFresh =
      row.expiresAt.getTime() - Date.now() >
      REFRESH_EARLY_MARGIN_SECONDS * 1000;
    if (stillFresh) {
      return this.encryption.decrypt(row.accessTokenEncrypted);
    }

    if (!row.refreshTokenEncrypted) {
      await this.markReauthRequired(row.id);
      throw new ReauthRequiredError(
        'Confluence connection has no refresh token. Reconnect to continue.',
      );
    }

    try {
      const tokens = await this.refreshToken(
        this.encryption.decrypt(row.refreshTokenEncrypted),
      );
      if (!tokens.access_token || !tokens.expires_in) {
        await this.markReauthRequired(row.id);
        throw new ReauthRequiredError(
          'Atlassian did not return refreshed credentials. Reconnect to continue.',
        );
      }
      await this.db
        .update(oauthConnections)
        .set({
          accessTokenEncrypted: this.encryption.encrypt(tokens.access_token),
          expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          // Atlassian rotates the refresh_token on every refresh — keep the
          // new one if returned, otherwise keep the existing one.
          refreshTokenEncrypted: tokens.refresh_token
            ? this.encryption.encrypt(tokens.refresh_token)
            : row.refreshTokenEncrypted,
          updatedAt: new Date(),
        })
        .where(eq(oauthConnections.id, row.id));
      return tokens.access_token;
    } catch (err) {
      if (err instanceof ReauthRequiredError) throw err;
      await this.markReauthRequired(row.id);
      throw new ReauthRequiredError(
        'Refreshing the Confluence token failed. Reconnect to continue.',
      );
    }
  }

  /**
   * Touch lastSyncedAt on the connection. Called after a successful import /
   * re-sync so the FE can show "Synced 5 minutes ago".
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
   * Drop the connection. Atlassian exposes no first-party 3LO token-revoke
   * endpoint, so this only removes the local row (the user can revoke the
   * grant from their Atlassian account settings). confluence_import_sources
   * rows cascade away via the FK; imported knowledge_files rows stay.
   */
  async disconnect(userId: string): Promise<void> {
    await this.db
      .delete(oauthConnections)
      .where(
        and(
          eq(oauthConnections.ownerId, userId),
          eq(oauthConnections.provider, PROVIDER),
        ),
      );
  }

  /** Internal accessor for the client service. Returns the row (or throws). */
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
    if (!row) throw new ReauthRequiredError('Confluence is not connected.');
    return row;
  }

  private async exchangeCode(code: string): Promise<AtlassianTokenResponse> {
    const res = await fetch(ATLASSIAN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: this.config.getOrThrow<string>('CONFLUENCE_CLIENT_ID'),
        client_secret: this.config.getOrThrow<string>(
          'CONFLUENCE_CLIENT_SECRET',
        ),
        code,
        redirect_uri: this.redirectUri(),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new BadRequestException(
        `Atlassian token exchange failed (${res.status}). ${detail.slice(0, 200)}`,
      );
    }
    return (await res.json()) as AtlassianTokenResponse;
  }

  private async refreshToken(
    refreshToken: string,
  ): Promise<AtlassianTokenResponse> {
    const res = await fetch(ATLASSIAN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: this.config.getOrThrow<string>('CONFLUENCE_CLIENT_ID'),
        client_secret: this.config.getOrThrow<string>(
          'CONFLUENCE_CLIENT_SECRET',
        ),
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) {
      throw new Error(`Atlassian token refresh failed (${res.status}).`);
    }
    return (await res.json()) as AtlassianTokenResponse;
  }

  private async markReauthRequired(connectionId: string): Promise<void> {
    await this.db
      .update(oauthConnections)
      .set({ status: 'reauth_required', updatedAt: new Date() })
      .where(eq(oauthConnections.id, connectionId));
  }
}
