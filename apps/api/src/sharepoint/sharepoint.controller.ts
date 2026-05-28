import { Controller, Delete, Get, Param, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import {
  SharePointOAuthService,
  type SharePointStatus,
} from './sharepoint-oauth.service.js';
import { SharePointGraphService } from './sharepoint-graph.service.js';

/**
 * Endpoints that own the *connection* lifecycle (and raw SharePoint
 * browsing for the site/drive/folder picker). The SharePoint-to-KC
 * import/Re-sync lives on KnowledgeCoreController at
 * `/knowledge-core/sharepoint/...` — split so each surface stays
 * close to its module's other concerns.
 */
@Controller('sharepoint')
export class SharePointController {
  constructor(
    private readonly oauth: SharePointOAuthService,
    private readonly graph: SharePointGraphService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Connection status for the current user. Drives the FE toolbar:
   *   - `connected: false` → "Connect SharePoint" button
   *   - `connected: true, status: 'active'` → "Import from SharePoint"
   *     button + connected-as chip
   *   - `connected: true, status: 'reauth_required'` → "Reconnect"
   *     button + warning chip
   */
  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser): Promise<SharePointStatus> {
    return this.oauth.getStatus(user.id);
  }

  /**
   * Start the SharePoint connect flow. We 302 the user's browser
   * straight to Microsoft's consent screen so the FE only needs
   * `window.location.href = '/api/sharepoint/connect'`.
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
   * Microsoft's redirect lands here with ?code + ?state. Public
   * because the auth cookie doesn't always survive the round-trip
   * through login.microsoftonline.com — we rely on the signed state
   * JWT as the authoritative identity for this single endpoint.
   *
   * On success or failure we redirect back to /knowledge-core with a
   * `?sharepoint=connected` / `?sharepoint=error=...` flag the FE
   * picks up to toast accordingly.
   */
  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const frontendUrl = this.config.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );

    if (error) {
      // Microsoft includes a verbose error_description; prefer that
      // so the FE toast can pinpoint admin-consent issues
      // (AADSTS65001), redirect mismatches (AADSTS50011), etc.
      const detail = errorDescription || error;
      res.redirect(
        `${frontendUrl}/knowledge-core?sharepoint=error=${encodeURIComponent(detail)}`,
      );
      return;
    }

    if (!code || !state) {
      res.redirect(
        `${frontendUrl}/knowledge-core?sharepoint=error=${encodeURIComponent('missing_code_or_state')}`,
      );
      return;
    }

    try {
      await this.oauth.handleCallback(code, state);
      res.redirect(`${frontendUrl}/knowledge-core?sharepoint=connected`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      res.redirect(
        `${frontendUrl}/knowledge-core?sharepoint=error=${encodeURIComponent(message)}`,
      );
    }
  }

  /**
   * Drop the connection. SharePoint-import-sources rows cascade
   * away via FK. Imported knowledge_files rows stay — the user
   * removes them via the normal KC delete path.
   */
  @Delete('connection')
  async disconnect(@CurrentUser() user: AuthenticatedUser) {
    await this.oauth.disconnect(user.id);
    return { success: true };
  }

  /**
   * List SharePoint sites the user can access. Drives the FE site
   * picker — first step of the import dialog.
   */
  @Get('sites')
  sites(@CurrentUser() user: AuthenticatedUser) {
    return this.graph.listSites(user.id);
  }

  /**
   * List drives (document libraries) on a site. Most sites have one;
   * some have multiple. The FE auto-selects when there's exactly one.
   */
  @Get('sites/:siteId/drives')
  drives(
    @CurrentUser() user: AuthenticatedUser,
    @Param('siteId') siteId: string,
  ) {
    return this.graph.listDrives(user.id, siteId);
  }

  /**
   * List immediate folder children of `parentId` inside a drive.
   * Defaults to the drive root. Drives the FE folder picker's lazy
   * expand — each caret click hits this endpoint.
   */
  @Get('sites/:siteId/drives/:driveId/folders')
  folders(
    @CurrentUser() user: AuthenticatedUser,
    @Param('siteId') _siteId: string,
    @Param('driveId') driveId: string,
    @Query('parentId') parentId?: string,
  ) {
    return this.graph.listFolders(user.id, driveId, parentId || undefined);
  }
}
