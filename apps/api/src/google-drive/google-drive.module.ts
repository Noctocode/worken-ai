import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { OpenRouterModule } from '../openrouter/openrouter.module.js';
import { GoogleDriveController } from './google-drive.controller.js';
import { GoogleDriveOAuthService } from './google-drive-oauth.service.js';
import { GoogleDriveClientService } from './google-drive-client.service.js';

/**
 * Owns the Google Drive OAuth flow + raw Drive API client used by
 * Knowledge Core's import path. Exports both services so
 * KnowledgeCoreModule can inject them — KC owns the file→KC
 * orchestration (DriveImportService) and the user-facing import +
 * Re-sync endpoints, this module owns only the connection itself.
 *
 * Imports OpenRouterModule for EncryptionService — same AES-256-GCM
 * helper that wraps BYOK keys reuses cleanly for OAuth refresh tokens.
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
  controllers: [GoogleDriveController],
  providers: [GoogleDriveOAuthService, GoogleDriveClientService],
  exports: [GoogleDriveOAuthService, GoogleDriveClientService],
})
export class GoogleDriveModule {}
