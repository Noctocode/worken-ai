import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { MicrosoftModule } from '../microsoft/microsoft.module.js';
import { OneDriveController } from './onedrive.controller.js';
import { OneDriveGraphService } from './onedrive-graph.service.js';

/**
 * OneDrive surface of the shared Microsoft Graph connection. Parallel
 * structure to SharePointModule — the actual OAuth lifecycle lives in
 * MicrosoftModule; this module owns only the OneDrive-specific Graph
 * wrapper (talking to /me/drive) and the per-product controller
 * endpoints (status / connect / enable / disconnect plus folder
 * browsing).
 */
@Module({
  imports: [ConfigModule, MicrosoftModule],
  controllers: [OneDriveController],
  providers: [OneDriveGraphService],
  exports: [OneDriveGraphService],
})
export class OneDriveModule {}
