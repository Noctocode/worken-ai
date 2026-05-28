import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { OpenRouterModule } from '../openrouter/openrouter.module.js';
import { SharePointController } from './sharepoint.controller.js';
import { SharePointOAuthService } from './sharepoint-oauth.service.js';
import { SharePointGraphService } from './sharepoint-graph.service.js';

/**
 * Owns the SharePoint (Microsoft Graph) OAuth flow + raw Graph API
 * client used by Knowledge Core's import path. Mirrors
 * GoogleDriveModule exactly — KC owns the file→KC orchestration
 * (SharePointImportService) and the user-facing import + Re-sync
 * endpoints, this module owns only the connection itself.
 *
 * Imports OpenRouterModule for EncryptionService — same AES-256-GCM
 * helper that wraps BYOK keys reuses for OAuth refresh tokens.
 */
@Module({
  imports: [
    ConfigModule,
    // State JWT for the OAuth callback uses JwtModule (signed with
    // JWT_SECRET); .register({}) defers all options to per-call
    // signAsync / verifyAsync options inside the OAuth service.
    JwtModule.register({}),
    OpenRouterModule,
  ],
  controllers: [SharePointController],
  providers: [SharePointOAuthService, SharePointGraphService],
  exports: [SharePointOAuthService, SharePointGraphService],
})
export class SharePointModule {}
