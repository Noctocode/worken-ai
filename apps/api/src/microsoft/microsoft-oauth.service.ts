import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import { oauthConnections } from '@worken/database/schema';

import { ReauthRequiredError } from '../common/errors/reauth-required.error.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { EncryptionService } from '../openrouter/encryption.service.js';

// Re-exported so callers that previously imported from sharepoint-oauth
// (or that want a one-stop shop) don't need to chase a separate path.
// New code can import directly from '../common/errors/reauth-required.error'.
export { ReauthRequiredError };

/**
 * Microsoft Graph scope set we request. The SUPERSET so the resulting
 * token works for BOTH SharePoint and OneDrive regardless of which
 * product the user used to kick off the OAuth flow:
 *
 *   - `Files.Read.All`  — any file the signed-in user can access
 *                         (OneDrive + SharePoint).
 *   - `Sites.Read.All`  — SharePoint site listing.
 *   - `User.Read`       — connected account email for the FE chip.
 *   - `offline_access`  — refresh token.
 */
const MICROSOFT_SCOPES = [
  'Files.Read.All',
  'Sites.Read.All',
  'User.Read',
  'offline_access',
];

/**
 * Scopes we hard-require in the returned grant. Only `Files.Read.All`
 * is non-negotiable. `Sites.Read.All` and `offline_access` may be
 * silently stripped by Microsoft for personal accounts — see the
 * lengthy reasoning the SharePoint integration documented when we
 * relaxed these to soft-warn.
 */
const REQUIRED_SCOPES = ['Files.Read.All'];
const OPTIONAL_SCOPES = ['Sites.Read.All', 'offline_access'];

/**
 * Single provider row in `oauth_connections` covers BOTH SharePoint
 * and OneDrive. The per-product `features` JSONB column tracks which
 * one(s) are currently enabled for the user.
 */
const PROVIDER = 'microsoft';

const REFRESH_EARLY_MARGIN_SECONDS = 60;
const STATE_TOKEN_TTL_SECONDS = 600;
const GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me';

export type MicrosoftProduct = 'sharepoint' | 'onedrive';
export type MicrosoftConnectPurpose = 'sharepoint-connect' | 'onedrive-connect';

/**
 * Status the FE shows on a per-product section. Each product
 * independently checks its enable flag — a Microsoft connection
 * exists doesn't necessarily mean THIS product is enabled.
 */
export interface MicrosoftProductStatus {
  connected: boolean;
  accountEmail?: string;
  status?: 'active' | 'reauth_required';
  scope?: string;
  lastSyncedAt?: string;
  /**
   * Whether the OTHER product is also enabled on the same connection.
   * Drives the FE's confirm-dialog mode (initial vs addon vs both).
   */
  otherProductEnabled?: boolean;
  /**
   * True iff a Microsoft connection row exists for the user (regardless
   * of which products are enabled). Lets the FE decide whether to run
   * a full OAuth roundtrip or just call /enable.
   */
  connectionExists?: boolean;
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

interface FeaturesShape {
  sharepoint?: boolean;
  onedrive?: boolean;
}

@Injectable()
export class MicrosoftOAuthService {
  private readonly logger = new Logger(MicrosoftOAuthService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Defensively trim every env value we feed into Microsoft URLs.
   * Stray trailing whitespace on a .env line survives into the
   * `ConfigService.get` and corrupts the authorize URL — surfacing
   * as AADSTS50011 or "redirect_uri is not valid". This helper makes
   * those mistakes impossible.
   */
  private readEnv(key: string, fallback?: string): string {
    const raw = this.config.get<string>(key);
    const trimmed = raw?.trim() ?? fallback ?? '';
    if (!trimmed) {
      if (fallback === undefined) {
        throw new Error(`Required env var ${key} is empty`);
      }
      return fallback;
    }
    return trimmed;
  }

  private get tenant(): string {
    return this.readEnv('MICROSOFT_TENANT_ID', 'common');
  }

  private get clientId(): string {
    return this.readEnv('MICROSOFT_CLIENT_ID');
  }

  private get clientSecret(): string {
    return this.readEnv('MICROSOFT_CLIENT_SECRET');
  }

  /**
   * The redirect URI we tell Microsoft to send the user back to is
   * per-product: SharePoint and OneDrive each have their own
   * registered redirect URI in the Azure App. Picking the right one
   * up-front (before consent) ensures the callback lands on the
   * controller that knows how to redirect back to the right
   * FE section (?sharepoint=connected vs ?onedrive=connected).
   */
  private redirectUriFor(purpose: MicrosoftConnectPurpose): string {
    return purpose === 'sharepoint-connect'
      ? this.readEnv(
          'SHAREPOINT_REDIRECT_URI',
          'http://localhost:3001/sharepoint/callback',
        )
      : this.readEnv(
          'ONEDRIVE_REDIRECT_URI',
          'http://localhost:3001/onedrive/callback',
        );
  }

  private get authorizeEndpoint(): string {
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/authorize`;
  }

  private get tokenEndpoint(): string {
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`;
  }

  /**
   * Build the Microsoft consent URL. `productsToEnable` is encoded in
   * the state JWT so the callback knows which feature flags to set on
   * success — letting a user opt into "just SharePoint" or "both"
   * from the same OAuth round-trip.
   */
  async buildConsentUrl(
    userId: string,
    purpose: MicrosoftConnectPurpose,
    productsToEnable: MicrosoftProduct[],
  ): Promise<string> {
    if (productsToEnable.length === 0) {
      throw new BadRequestException(
        'At least one product must be specified for the consent flow.',
      );
    }
    const state = await this.jwt.signAsync(
      { sub: userId, purpose, products: productsToEnable },
      {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: STATE_TOKEN_TTL_SECONDS,
      },
    );

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUriFor(purpose),
      response_mode: 'query',
      scope: MICROSOFT_SCOPES.join(' '),
      state,
      prompt: 'consent',
    });

    return `${this.authorizeEndpoint}?${params.toString()}`;
  }

  /**
   * Exchange the fresh consent code for tokens and persist them.
   * On success, MERGES the products from the state JWT into the
   * existing `features` flags — so a SharePoint-only connect doesn't
   * accidentally disable a previously-enabled OneDrive flag.
   *
   * Validates scopes against REQUIRED_SCOPES (hard-fail) and
   * OPTIONAL_SCOPES (soft-warn). See the lengthy module-level
   * comment for personal-MSA reasoning.
   */
  async handleCallback(
    code: string,
    state: string,
    expectedPurpose: MicrosoftConnectPurpose,
  ): Promise<{ userId: string; productsEnabled: MicrosoftProduct[] }> {
    let userId: string;
    let productsToEnable: MicrosoftProduct[];
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        purpose?: string;
        products?: MicrosoftProduct[];
      }>(state, { secret: this.config.getOrThrow<string>('JWT_SECRET') });
      if (payload.purpose !== expectedPurpose) {
        throw new BadRequestException('Invalid OAuth state purpose.');
      }
      userId = payload.sub;
      productsToEnable = Array.isArray(payload.products)
        ? payload.products.filter(
            (p): p is MicrosoftProduct =>
              p === 'sharepoint' || p === 'onedrive',
          )
        : [];
      if (productsToEnable.length === 0) {
        // Defensive — older callers that don't include products in the
        // state JWT default to enabling the product that matches the
        // purpose.
        productsToEnable =
          expectedPurpose === 'sharepoint-connect'
            ? ['sharepoint']
            : ['onedrive'];
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        'OAuth state token is invalid or expired. Restart the connect flow.',
      );
    }

    const tokens = await this.exchangeCodeForTokens(
      code,
      this.redirectUriFor(expectedPurpose),
    );

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

    const [existing] = await this.db
      .select()
      .from(oauthConnections)
      .where(
        and(
          eq(oauthConnections.ownerId, userId),
          eq(oauthConnections.provider, PROVIDER),
        ),
      );

    // Merge products into existing features rather than replacing —
    // a SharePoint-only re-connect must NOT clobber a prior OneDrive
    // enable flag.
    const existingFeatures: FeaturesShape =
      (existing?.features as FeaturesShape) ?? {};
    const mergedFeatures: FeaturesShape = { ...existingFeatures };
    for (const p of productsToEnable) {
      mergedFeatures[p] = true;
    }

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
          features: mergedFeatures,
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
        features: mergedFeatures,
      });
    }

    return { userId, productsEnabled: productsToEnable };
  }

  /**
   * Status check scoped to one product. Returns connected=true ONLY
   * when both (a) the connection row exists AND (b) the product is
   * enabled in the row's features JSONB. Also returns whether the
   * other product is enabled and whether the underlying row exists —
   * the FE uses both to drive the confirm-dialog mode.
   */
  async getStatusFor(
    userId: string,
    product: MicrosoftProduct,
  ): Promise<MicrosoftProductStatus> {
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
      return { connected: false, connectionExists: false };
    }
    const features = (row.features as FeaturesShape) ?? {};
    const productEnabled = features[product] === true;
    const otherProduct: MicrosoftProduct =
      product === 'sharepoint' ? 'onedrive' : 'sharepoint';
    return {
      connected: productEnabled,
      connectionExists: true,
      accountEmail: row.accountEmail ?? undefined,
      status: row.status as 'active' | 'reauth_required',
      scope: row.scope,
      lastSyncedAt: row.lastSyncedAt?.toISOString(),
      otherProductEnabled: features[otherProduct] === true,
    };
  }

  /**
   * Toggle a single product's enable flag without an OAuth round-trip.
   * Used for the "Microsoft already connected, just enable the other
   * product" path.
   *
   * When both features become false on a disable call, the whole
   * connection row is deleted — no point keeping a token nobody is
   * authorised to use.
   */
  async setFeature(
    userId: string,
    product: MicrosoftProduct,
    enabled: boolean,
  ): Promise<void> {
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
      if (enabled) {
        throw new BadRequestException(
          `Cannot enable ${product}: no Microsoft connection exists. Run the connect flow first.`,
        );
      }
      // No row + disable request → no-op.
      return;
    }
    const features: FeaturesShape = {
      ...((row.features as FeaturesShape) ?? {}),
    };
    features[product] = enabled;

    const anyEnabled =
      features.sharepoint === true || features.onedrive === true;

    if (!anyEnabled) {
      // No products left enabled — delete the row, no orphan token.
      await this.db
        .delete(oauthConnections)
        .where(eq(oauthConnections.id, row.id));
      return;
    }
    await this.db
      .update(oauthConnections)
      .set({ features, updatedAt: new Date() })
      .where(eq(oauthConnections.id, row.id));
  }

  /**
   * Returns a valid access token for the given user, refreshing if
   * needed. Token is product-agnostic — any caller (SP or OneDrive
   * Graph services) gets the same token because they share the
   * same Microsoft connection row.
   *
   * Throws ReauthRequiredError on refresh failure / no connection /
   * narrowed scopes — caller surfaces as 401 to FE which shows the
   * Reconnect button.
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
      throw new ReauthRequiredError('Microsoft is not connected.');
    }
    if (row.status === 'reauth_required') {
      throw new ReauthRequiredError(
        'Microsoft connection needs reauthorization.',
      );
    }

    const nowMs = Date.now();
    const expiresMs = row.expiresAt.getTime();
    const stillFresh = expiresMs - nowMs > REFRESH_EARLY_MARGIN_SECONDS * 1000;
    if (stillFresh) {
      return this.encryption.decrypt(row.accessTokenEncrypted);
    }

    if (!row.refreshTokenEncrypted) {
      await this.markReauthRequired(row.id);
      throw new ReauthRequiredError(
        'Microsoft connection has no refresh token. Reconnect to continue.',
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

      const grantedScopes = (refreshed.scope ?? row.scope ?? '')
        .split(/\s+/)
        .filter(Boolean);
      try {
        this.assertRequiredScopes(grantedScopes);
      } catch {
        await this.markReauthRequired(row.id);
        throw new ReauthRequiredError(
          'Microsoft permissions were narrowed since you connected. Reconnect to continue.',
        );
      }

      await this.db
        .update(oauthConnections)
        .set({
          accessTokenEncrypted: this.encryption.encrypt(refreshed.access_token),
          expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
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
        'Refreshing the Microsoft token failed. Reconnect to continue.',
      );
    }
  }

  /**
   * Touch lastSyncedAt on the shared connection. Both SharePoint and
   * OneDrive import services call this after a successful sync so the
   * FE chip shows the most recent activity time regardless of which
   * product triggered it.
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
   * Full disconnect — delete the connection row regardless of which
   * products are enabled. Used by the "Disconnect both" branch.
   * For "Disconnect just this product" the controllers call
   * setFeature(..., false) instead.
   *
   * Azure has no public v2 revoke endpoint (per docs the user revokes
   * from account.microsoft.com / Entra "My Apps") so we just delete
   * the local row. Source rows cascade away via FK; imported
   * knowledge_files rows stay (user removes them via normal KC).
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

  /** Internal accessor for Graph clients. Returns the row (or throws). */
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
    if (!row) throw new ReauthRequiredError('Microsoft is not connected.');
    return row;
  }

  private async markReauthRequired(connectionId: string): Promise<void> {
    await this.db
      .update(oauthConnections)
      .set({ status: 'reauth_required', updatedAt: new Date() })
      .where(eq(oauthConnections.id, connectionId));
  }

  private assertRequiredScopes(grantedScopes: string[]): void {
    const granted = new Set(
      grantedScopes.map((s) => (s.split('/').pop() ?? s).toLowerCase()),
    );
    const lcRequired = REQUIRED_SCOPES.map((s) => s.toLowerCase());
    const lcOptional = OPTIONAL_SCOPES.map((s) => s.toLowerCase());

    this.logger.log(`Microsoft returned scopes: [${grantedScopes.join(', ')}]`);

    const missingRequired = lcRequired.filter((s) => !granted.has(s));
    if (missingRequired.length > 0) {
      throw new BadRequestException(
        `Microsoft permission missing: ${missingRequired.join(', ')}. ` +
          `Reconnect and accept the requested access. ` +
          `(If you signed in with a personal Microsoft account, switch ` +
          `to a work/school account — personal accounts can't grant Files.Read.All.)`,
      );
    }

    const missingOptional = lcOptional.filter((s) => !granted.has(s));
    if (missingOptional.length > 0) {
      this.logger.warn(
        `Microsoft connect missing optional scope(s): ${missingOptional.join(', ')}. ` +
          `Connection will still work but some features may degrade ` +
          `(no SharePoint site list / no refresh after 1h).`,
      );
    }
  }

  private async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
  ): Promise<MicrosoftTokenResponse> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: MICROSOFT_SCOPES.join(' '),
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
      scope: MICROSOFT_SCOPES.join(' '),
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
