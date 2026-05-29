import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { OpenRouterModule } from '../openrouter/openrouter.module.js';
import { MicrosoftOAuthService } from './microsoft-oauth.service.js';

/**
 * Shared Microsoft Graph OAuth lifecycle (token storage, refresh,
 * scope verification, per-product feature flags). One row in
 * `oauth_connections` with `provider='microsoft'` backs BOTH the
 * SharePoint and OneDrive sections — each product checks its own
 * enable flag via `MicrosoftOAuthService.getStatusFor`.
 *
 * Exports `MicrosoftOAuthService` so SharePointModule + OneDriveModule
 * + KnowledgeCoreModule can inject it without going through a
 * product-specific facade.
 */
@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    OpenRouterModule,
  ],
  providers: [MicrosoftOAuthService],
  exports: [MicrosoftOAuthService],
})
export class MicrosoftModule {}
