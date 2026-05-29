import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { MicrosoftModule } from '../microsoft/microsoft.module.js';
import { SharePointController } from './sharepoint.controller.js';
import { SharePointGraphService } from './sharepoint-graph.service.js';

/**
 * SharePoint surface of the shared Microsoft Graph connection. The
 * actual OAuth lifecycle (token storage, refresh, scope verification,
 * per-product feature flags) lives in `MicrosoftModule` — this module
 * owns only the SharePoint-specific Graph wrapper and the per-product
 * controller endpoints (status / connect / enable / disconnect plus
 * site / drive / folder browsing).
 *
 * OneDrive has a parallel module with the same shape, both consuming
 * the same MicrosoftOAuthService.
 */
@Module({
  imports: [ConfigModule, MicrosoftModule],
  controllers: [SharePointController],
  providers: [SharePointGraphService],
  exports: [SharePointGraphService],
})
export class SharePointModule {}
