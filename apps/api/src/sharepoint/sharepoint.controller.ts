import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import {
  MicrosoftOAuthService,
  type MicrosoftProduct,
  type MicrosoftProductStatus,
} from '../microsoft/microsoft-oauth.service.js';
import { SharePointGraphService } from './sharepoint-graph.service.js';

const VALID_PRODUCTS: MicrosoftProduct[] = ['sharepoint', 'onedrive'];

function parseProducts(raw: string | undefined): MicrosoftProduct[] {
  if (!raw) return ['sharepoint'];
  const list = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is MicrosoftProduct =>
      VALID_PRODUCTS.includes(s as MicrosoftProduct),
    );
  return list.length > 0 ? list : ['sharepoint'];
}

/**
 * Endpoints that own the SharePoint surface of the shared Microsoft
 * connection. OAuth lifecycle now lives in `MicrosoftOAuthService`
 * (single row in oauth_connections backs BOTH this and OneDrive),
 * and this controller adds the per-product feature toggle and the
 * SharePoint-specific site/drive/folder browsing.
 */
@Controller('sharepoint')
export class SharePointController {
  constructor(
    private readonly oauth: MicrosoftOAuthService,
    private readonly graph: SharePointGraphService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Status for the SharePoint UI section. `connected=true` only when
   * the Microsoft row exists AND `features.sharepoint === true` —
   * a user with `features.onedrive=true` only sees this section as
   * "Not connected".
   */
  @Get('status')
  status(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MicrosoftProductStatus> {
    return this.oauth.getStatusFor(user.id, 'sharepoint');
  }

  /**
   * Start the SharePoint connect flow. Accepts `?products=` so the
   * FE confirm dialog can encode the user's choice ("Just SharePoint"
   * vs "Both products"). Defaults to ['sharepoint'] when omitted.
   */
  @Get('connect')
  async connect(
    @CurrentUser() user: AuthenticatedUser,
    @Query('products') productsRaw: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const products = parseProducts(productsRaw);
    const url = await this.oauth.buildConsentUrl(
      user.id,
      'sharepoint-connect',
      products,
    );
    res.redirect(url);
  }

  /**
   * Microsoft's redirect lands here with ?code + ?state. Public
   * because the auth cookie doesn't always survive the round-trip.
   * State JWT carries the products to enable.
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
      await this.oauth.handleCallback(code, state, 'sharepoint-connect');
      res.redirect(`${frontendUrl}/knowledge-core?sharepoint=connected`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      res.redirect(
        `${frontendUrl}/knowledge-core?sharepoint=error=${encodeURIComponent(message)}`,
      );
    }
  }

  /**
   * Enable the SharePoint feature on an EXISTING Microsoft connection
   * (no OAuth round-trip). Throws 400 if no connection exists. Used by
   * the "Microsoft already connected via OneDrive — just enable SP"
   * confirm-dialog branch.
   */
  @Post('enable')
  async enable(@CurrentUser() user: AuthenticatedUser) {
    await this.oauth.setFeature(user.id, 'sharepoint', true);
    return { success: true };
  }

  /**
   * Disconnect from SharePoint. By default just toggles
   * `features.sharepoint=false` and keeps the connection if OneDrive
   * is still enabled. `?both=true` deletes the entire connection.
   *
   * `sharepoint_import_sources` rows cascade away via FK whenever the
   * underlying row is deleted; for the "just this" path the source
   * rows stay (they'll be unreachable until the user reconnects, but
   * the user can clean them up via KC delete).
   */
  @Delete('connection')
  async disconnect(
    @CurrentUser() user: AuthenticatedUser,
    @Query('both') both: string | undefined,
  ) {
    const disconnectAll = both === 'true' || both === '1';
    if (disconnectAll) {
      await this.oauth.disconnect(user.id);
    } else {
      await this.oauth.setFeature(user.id, 'sharepoint', false);
    }
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
