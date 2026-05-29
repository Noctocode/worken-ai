import { Controller, Delete, Get, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import {
  GoogleDriveOAuthService,
  type DriveStatus,
} from './google-drive-oauth.service.js';
import { GoogleDriveClientService } from './google-drive-client.service.js';

/**
 * Endpoints that own the *connection* lifecycle (and raw Drive
 * browsing for the folder picker). The Drive-to-KC import/Re-sync
 * lives on KnowledgeCoreController at `/knowledge-core/drive/...`
 * — split so each surface stays close to its module's other
 * concerns. The FE doesn't care; it just hits both prefixes.
 */
@Controller('google-drive')
export class GoogleDriveController {
  constructor(
    private readonly oauth: GoogleDriveOAuthService,
    private readonly drive: GoogleDriveClientService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Connection status for the current user. Drives the FE toolbar:
   *   - `connected: false` → "Connect Google Drive" button
   *   - `connected: true, status: 'active'` → "Import from Drive"
   *     button + connected-as chip
   *   - `connected: true, status: 'reauth_required'` → "Reconnect"
   *     button + warning chip
   */
  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser): Promise<DriveStatus> {
    return this.oauth.getStatus(user.id);
  }

  /**
   * Start the Drive connect flow. We 302 the user's browser to
   * Google's consent screen directly so the FE only has to do
   * `window.location.href = '/api/google-drive/connect'`.
   */
  @Get('connect')
  async connect(
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const url = await this.oauth.buildConsentUrl(user.id);
    res.redirect(url);
  }

  /**
   * Google's redirect lands here with ?code + ?state. Public because
   * cookies don't always survive the round-trip through
   * accounts.google.com (Safari ITP, third-party-cookie blockers) —
   * we rely on the signed state JWT as the authoritative identity
   * for this single endpoint.
   *
   * On success or failure we redirect back to /knowledge-core with a
   * `?drive=connected` / `?drive=error=...` flag the FE picks up to
   * toast accordingly.
   */
  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const frontendUrl = this.config.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );

    // User clicked "Deny" on the consent screen, or Google returned a
    // top-level error. Surface verbatim so the FE toast can be
    // specific ("access_denied" vs. a real failure).
    if (error) {
      res.redirect(
        `${frontendUrl}/knowledge-core?drive=error=${encodeURIComponent(error)}`,
      );
      return;
    }

    if (!code || !state) {
      res.redirect(
        `${frontendUrl}/knowledge-core?drive=error=${encodeURIComponent('missing_code_or_state')}`,
      );
      return;
    }

    try {
      await this.oauth.handleCallback(code, state);
      res.redirect(`${frontendUrl}/knowledge-core?drive=connected`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      res.redirect(
        `${frontendUrl}/knowledge-core?drive=error=${encodeURIComponent(message)}`,
      );
    }
  }

  /**
   * Drop the connection. Revokes the grant at Google's end (best
   * effort) and removes the local row. Drive-import-sources rows
   * cascade away via the FK. Imported knowledge_files rows stay —
   * the user removes them via the normal KC delete path.
   */
  @Delete('connection')
  async disconnect(@CurrentUser() user: AuthenticatedUser) {
    await this.oauth.disconnect(user.id);
    return { success: true };
  }

  /**
   * List the immediate folder children of `parentId` (defaults to the
   * user's My Drive root). Drives the FE folder picker's lazy expand —
   * each click on a caret hits this endpoint with the clicked
   * folder's id.
   */
  @Get('folders')
  folders(
    @CurrentUser() user: AuthenticatedUser,
    @Query('parentId') parentId?: string,
  ) {
    return this.drive.listFolders(user.id, parentId || 'root');
  }
}
