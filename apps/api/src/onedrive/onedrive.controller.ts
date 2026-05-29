import {
  Controller,
  Delete,
  Get,
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
import { OneDriveGraphService } from './onedrive-graph.service.js';

const VALID_PRODUCTS: MicrosoftProduct[] = ['sharepoint', 'onedrive'];

function parseProducts(raw: string | undefined): MicrosoftProduct[] {
  if (!raw) return ['onedrive'];
  const list = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is MicrosoftProduct =>
      VALID_PRODUCTS.includes(s as MicrosoftProduct),
    );
  return list.length > 0 ? list : ['onedrive'];
}

/**
 * Endpoints that own the OneDrive surface of the shared Microsoft
 * connection. Shape exactly mirrors SharePointController — same
 * status / connect / callback / enable / disconnect pattern — with
 * the OneDrive-specific folder browsing (no site/drive hierarchy,
 * just /me/drive).
 */
@Controller('onedrive')
export class OneDriveController {
  constructor(
    private readonly oauth: MicrosoftOAuthService,
    private readonly graph: OneDriveGraphService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Status for the OneDrive UI section. `connected=true` only when
   * the Microsoft row exists AND `features.onedrive === true`.
   */
  @Get('status')
  status(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MicrosoftProductStatus> {
    return this.oauth.getStatusFor(user.id, 'onedrive');
  }

  /**
   * Start the OneDrive connect flow. `?products=` lets the FE
   * confirm dialog encode the user's choice ("Just OneDrive" vs
   * "Both products"). Defaults to ['onedrive'] when omitted.
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
      'onedrive-connect',
      products,
    );
    res.redirect(url);
  }

  /**
   * Microsoft's redirect lands here with ?code + ?state. Public
   * because the auth cookie doesn't always survive the round-trip.
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
        `${frontendUrl}/knowledge-core?onedrive=error=${encodeURIComponent(detail)}`,
      );
      return;
    }

    if (!code || !state) {
      res.redirect(
        `${frontendUrl}/knowledge-core?onedrive=error=${encodeURIComponent('missing_code_or_state')}`,
      );
      return;
    }

    try {
      await this.oauth.handleCallback(code, state, 'onedrive-connect');
      res.redirect(`${frontendUrl}/knowledge-core?onedrive=connected`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      res.redirect(
        `${frontendUrl}/knowledge-core?onedrive=error=${encodeURIComponent(message)}`,
      );
    }
  }

  /**
   * Enable the OneDrive feature on an EXISTING Microsoft connection
   * (no OAuth round-trip). Used by the "Microsoft already connected
   * via SharePoint — just enable OneDrive" confirm-dialog branch.
   */
  @Post('enable')
  async enable(@CurrentUser() user: AuthenticatedUser) {
    await this.oauth.setFeature(user.id, 'onedrive', true);
    return { success: true };
  }

  /**
   * Disconnect from OneDrive. By default just toggles
   * `features.onedrive=false` and keeps the connection if SharePoint
   * is still enabled. `?both=true` deletes the entire connection.
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
      await this.oauth.setFeature(user.id, 'onedrive', false);
    }
    return { success: true };
  }

  /**
   * List immediate folder children of `parentId` inside the user's
   * OneDrive. Defaults to the drive root. Drives the FE folder
   * picker's lazy expand.
   */
  @Get('folders')
  folders(
    @CurrentUser() user: AuthenticatedUser,
    @Query('parentId') parentId?: string,
  ) {
    return this.graph.listFolders(user.id, parentId || undefined);
  }
}
