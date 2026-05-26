import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import { google, Auth } from 'googleapis';
import { oauthConnections } from '@worken/database/schema';

import { DATABASE, type Database } from '../database/database.module.js';
import { EncryptionService } from '../openrouter/encryption.service.js';

/**
 * Drive scope set we request. `drive.readonly` covers both metadata
 * listing and file download (incl. `files.export` for Google native
 * formats); `userinfo.email` is what lets us cache the connected
 * account email for display.
 *
 * If you change this set, you MUST bump the `requiredScopes` check
 * below — Google can return a subset of what we asked for, and we
 * want to reject a partial grant up-front instead of silently 401-ing
 * on every Drive call later.
 */
const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

const REQUIRED_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

const PROVIDER = 'google_drive';

/**
 * Refresh the access token when fewer than this many seconds remain on
 * the current one. 60s gives the typical Drive API call enough runway
 * to land before the token would have expired mid-flight.
 */
const REFRESH_EARLY_MARGIN_SECONDS = 60;

/**
 * State JWT used to bind a Google consent callback back to the user
 * who started it. CSRF protection: without this, a third party could
 * trick a logged-in user into hitting /callback with a code that
 * connects the attacker's Drive to the victim's account. Verified +
 * single-use through the short expiry.
 */
const STATE_TOKEN_TTL_SECONDS = 600; // 10 min — covers consent + multi-step grant

export interface DriveStatus {
  connected: boolean;
  accountEmail?: string;
  status?: 'active' | 'reauth_required';
  /** Granted scope set. Useful for FE to surface "missing scope" diagnostics. */
  scope?: string;
  lastSyncedAt?: string;
}

export class ReauthRequiredError extends UnauthorizedException {
  constructor(message = 'Google Drive connection needs reauthorization.') {
    super(message);
  }
}

@Injectable()
export class GoogleDriveOAuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Per-call OAuth2Client factory. The library is stateful — credentials
   * live on the instance — so we deliberately don't share a single
   * client across users. Cheap to create.
   */
  private newOAuth2Client(): Auth.OAuth2Client {
    return new google.auth.OAuth2(
      this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      this.config.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      this.config.get<string>(
        'GOOGLE_DRIVE_REDIRECT_URI',
        'http://localhost:3001/google-drive/callback',
      ),
    );
  }

  /**
   * Build the Google consent URL the FE should redirect the user to.
   * Requests `drive.readonly` incrementally on top of the existing
   * sign-in grant — `include_granted_scopes=true` means Google won't
   * surface an "email + profile" re-consent screen, only the new
   * Drive permission.
   *
   * `prompt=consent` forces Google to issue a fresh refresh_token even
   * if the user has previously granted offline access for this client
   * — without it, the second connect of a previously-disconnected
   * account would land an access_token but no refresh_token, breaking
   * the 1-hour-later refresh path.
   *
   * `state` is a short-lived signed JWT containing the initiating
   * `userId`; the callback verifies it before persisting any tokens.
   * Standard CSRF guard.
   */
  async buildConsentUrl(userId: string): Promise<string> {
    const state = await this.jwt.signAsync(
      { sub: userId, purpose: 'google-drive-connect' },
      {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: STATE_TOKEN_TTL_SECONDS,
      },
    );

    return this.newOAuth2Client().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: DRIVE_SCOPES,
      state,
    });
  }

  /**
   * Exchange a fresh consent code for tokens and persist them under
   * the initiating userId. Replaces an existing connection if the user
   * is reconnecting (unique constraint on (owner_id, provider)).
   *
   * Validates that Google returned the scopes we actually need —
   * users can untick boxes on the consent screen and a partial grant
   * would silently 401 on every Drive call later.
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
      if (payload.purpose !== 'google-drive-connect') {
        throw new BadRequestException('Invalid OAuth state purpose.');
      }
      userId = payload.sub;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        'OAuth state token is invalid or expired. Restart the connect flow.',
      );
    }

    const oauth2 = this.newOAuth2Client();
    const { tokens } = await oauth2.getToken(code);

    if (!tokens.access_token) {
      throw new BadRequestException(
        'Google did not return an access token. Try connecting again.',
      );
    }
    if (!tokens.expiry_date) {
      throw new BadRequestException(
        'Google did not return a token expiry. Try connecting again.',
      );
    }

    const grantedScopes = (tokens.scope ?? '').split(/\s+/).filter(Boolean);
    const missing = REQUIRED_SCOPES.filter((s) => !grantedScopes.includes(s));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Drive permission missing: ${missing.join(', ')}. Reconnect and accept the requested access.`,
      );
    }

    // Pull the connected account's email for the FE status chip.
    // Best-effort — if userinfo fails we still persist the connection
    // with email null and the chip falls back to "Connected".
    oauth2.setCredentials(tokens);
    let accountEmail: string | null = null;
    try {
      const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
      const me = await oauth2Api.userinfo.get();
      accountEmail = me.data.email ?? null;
    } catch {
      // swallow — display-only field
    }

    const accessTokenEncrypted = this.encryption.encrypt(tokens.access_token);
    const refreshTokenEncrypted = tokens.refresh_token
      ? this.encryption.encrypt(tokens.refresh_token)
      : null;
    const expiresAt = new Date(tokens.expiry_date);
    const scopeString = grantedScopes.join(' ');

    // Upsert: one connection per (owner, provider). If the row exists
    // (reconnect / scope upgrade), keep the previous refresh_token when
    // Google omits a new one on this round-trip. Google sometimes does
    // that even with prompt=consent — defensive guard against losing
    // offline access mid-rotation.
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

  async getStatus(userId: string): Promise<DriveStatus> {
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
   * if the stored one is within REFRESH_EARLY_MARGIN_SECONDS of expiry.
   * Used by GoogleDriveClientService before every Drive API call.
   *
   * On refresh failure (revoked grant, no refresh_token, …), flips the
   * connection to `status='reauth_required'` and throws
   * `ReauthRequiredError`. Caller surfaces that as a 401 to the FE,
   * which renders the "Reconnect Google Drive" prompt.
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
      throw new ReauthRequiredError('Google Drive is not connected.');
    }
    if (row.status === 'reauth_required') {
      throw new ReauthRequiredError();
    }

    const nowMs = Date.now();
    const expiresMs = row.expiresAt.getTime();
    const stillFresh = expiresMs - nowMs > REFRESH_EARLY_MARGIN_SECONDS * 1000;
    if (stillFresh) {
      return this.encryption.decrypt(row.accessTokenEncrypted);
    }

    // Refresh path. Without a refresh_token we can't recover — flip to
    // reauth_required and tell the user.
    if (!row.refreshTokenEncrypted) {
      await this.markReauthRequired(row.id);
      throw new ReauthRequiredError(
        'Google Drive connection has no refresh token. Reconnect to continue.',
      );
    }

    const oauth2 = this.newOAuth2Client();
    oauth2.setCredentials({
      refresh_token: this.encryption.decrypt(row.refreshTokenEncrypted),
    });

    try {
      const { credentials } = await oauth2.refreshAccessToken();
      if (!credentials.access_token || !credentials.expiry_date) {
        await this.markReauthRequired(row.id);
        throw new ReauthRequiredError(
          'Google did not return refreshed credentials. Reconnect to continue.',
        );
      }
      await this.db
        .update(oauthConnections)
        .set({
          accessTokenEncrypted: this.encryption.encrypt(
            credentials.access_token,
          ),
          expiresAt: new Date(credentials.expiry_date),
          // Google may rotate refresh_token on refresh; keep the new
          // one if returned, otherwise keep the existing one.
          refreshTokenEncrypted: credentials.refresh_token
            ? this.encryption.encrypt(credentials.refresh_token)
            : row.refreshTokenEncrypted,
          updatedAt: new Date(),
        })
        .where(eq(oauthConnections.id, row.id));
      return credentials.access_token;
    } catch (err) {
      if (err instanceof ReauthRequiredError) throw err;
      await this.markReauthRequired(row.id);
      throw new ReauthRequiredError(
        'Refreshing the Google Drive token failed. Reconnect to continue.',
      );
    }
  }

  /**
   * Touch lastSyncedAt on the connection. Called from
   * KnowledgeCoreService after a successful import / re-sync so the FE
   * can show "Synced 5 minutes ago" without a separate query.
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

    // Best-effort revoke at Google's end so the grant doesn't linger
    // in the user's connected-apps list. Failure here is non-fatal —
    // we still want the local row gone so the user can reconnect.
    try {
      const accessToken = this.encryption.decrypt(row.accessTokenEncrypted);
      await this.newOAuth2Client().revokeToken(accessToken);
    } catch {
      // swallow — local delete still happens below
    }

    await this.db
      .delete(oauthConnections)
      .where(eq(oauthConnections.id, row.id));
  }

  /** Internal accessor for the Drive client. Returns the row (or throws). */
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
    if (!row) throw new ReauthRequiredError('Google Drive is not connected.');
    return row;
  }

  private async markReauthRequired(connectionId: string): Promise<void> {
    await this.db
      .update(oauthConnections)
      .set({ status: 'reauth_required', updatedAt: new Date() })
      .where(eq(oauthConnections.id, connectionId));
  }
}
