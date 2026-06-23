import { Controller, Delete, Get, Param, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import {
  ConfluenceOAuthService,
  type ConfluenceStatus,
} from './confluence-oauth.service.js';
import { ConfluenceClientService } from './confluence-client.service.js';

/**
 * Endpoints that own the Confluence *connection* lifecycle (plus raw space
 * / page browsing for the import picker). The Confluence→KC import + Re-sync
 * lives on KnowledgeCoreController at `/knowledge-core/confluence/...`, the
 * same split the Drive / SharePoint integrations use.
 */
@Controller('confluence')
export class ConfluenceController {
  constructor(
    private readonly oauth: ConfluenceOAuthService,
    private readonly client: ConfluenceClientService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Connection status for the current user. Drives the FE toolbar:
   *   - `connected: false` → "Connect Confluence" button
   *   - `connected: true, status: 'active'` → "Import from Confluence"
   *   - `connected: true, status: 'reauth_required'` → "Reconnect" prompt
   */
  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser): Promise<ConfluenceStatus> {
    return this.oauth.getStatus(user.id);
  }

  /**
   * Start the connect flow. We 302 the browser straight to Atlassian's
   * consent screen so the FE only has to do
   * `window.location.href = '/api/confluence/connect'`.
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
   * Atlassian's redirect lands here with ?code + ?state. Public because
   * cookies don't always survive the round-trip through auth.atlassian.com
   * (Safari ITP, third-party-cookie blockers) — we rely on the signed state
   * JWT as the authoritative identity for this single endpoint.
   *
   * On success / failure we redirect back to /knowledge-core with a
   * `?confluence=connected` / `?confluence=error=...` flag the FE toasts on.
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

    if (error) {
      res.redirect(
        `${frontendUrl}/teams?tab=integration&confluence=error=${encodeURIComponent(error)}`,
      );
      return;
    }
    if (!code || !state) {
      res.redirect(
        `${frontendUrl}/teams?tab=integration&confluence=error=${encodeURIComponent('missing_code_or_state')}`,
      );
      return;
    }

    try {
      const { userId } = await this.oauth.handleCallback(code, state);
      // A reconnect may point at a different Atlassian site — drop any
      // cached cloudId so the next API call re-resolves it.
      this.client.clearSiteCache(userId);
      res.redirect(`${frontendUrl}/teams?tab=integration&confluence=connected`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      res.redirect(
        `${frontendUrl}/teams?tab=integration&confluence=error=${encodeURIComponent(message)}`,
      );
    }
  }

  /**
   * Drop the connection. Removes the local row (Atlassian has no first-party
   * 3LO revoke endpoint). confluence_import_sources rows cascade away via the
   * FK; imported knowledge_files rows stay.
   */
  @Delete('connection')
  async disconnect(@CurrentUser() user: AuthenticatedUser) {
    await this.oauth.disconnect(user.id);
    this.client.clearSiteCache(user.id);
    return { success: true };
  }

  /** List the Confluence spaces the connected account can read. */
  @Get('spaces')
  spaces(@CurrentUser() user: AuthenticatedUser) {
    return this.client.listSpaces(user.id);
  }

  /**
   * List every page in a space (flat, with parentId + hasChildren) so the FE
   * picker can build the page tree client-side. Cheap for typical spaces;
   * capped server-side for very large ones.
   */
  @Get('spaces/:spaceId/pages')
  pages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spaceId') spaceId: string,
  ) {
    return this.client.listAllPages(user.id, spaceId);
  }
}
