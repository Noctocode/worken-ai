import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { OpenRouterModule } from '../openrouter/openrouter.module.js';
import { ConfluenceController } from './confluence.controller.js';
import { ConfluenceOAuthService } from './confluence-oauth.service.js';
import { ConfluenceClientService } from './confluence-client.service.js';

/**
 * Owns the Confluence (Atlassian 3LO) OAuth flow + the v2 REST client used
 * by Knowledge Core's import path. Exports both services so
 * KnowledgeCoreModule can inject them — KC owns the page→KC orchestration
 * (ConfluenceImportService) and the user-facing import + Re-sync endpoints,
 * this module owns only the connection itself.
 *
 * Imports OpenRouterModule for EncryptionService — the same AES-256-GCM
 * helper that wraps BYOK keys also wraps the OAuth refresh tokens. JwtModule
 * backs the signed OAuth-state JWT (signed with JWT_SECRET via per-call
 * options).
 */
@Module({
  imports: [ConfigModule, JwtModule.register({}), OpenRouterModule],
  controllers: [ConfluenceController],
  providers: [ConfluenceOAuthService, ConfluenceClientService],
  exports: [ConfluenceOAuthService, ConfluenceClientService],
})
export class ConfluenceModule {}
