import { Module } from '@nestjs/common';
import { KnowledgeCoreController } from './knowledge-core.controller.js';
import { KnowledgeCoreService } from './knowledge-core.service.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';
import { DriveImportService } from './drive-import.service.js';
import { OneDriveImportService } from './onedrive-import.service.js';
import { SharePointImportService } from './sharepoint-import.service.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { GoogleDriveModule } from '../google-drive/google-drive.module.js';
import { MicrosoftModule } from '../microsoft/microsoft.module.js';
import { OneDriveModule } from '../onedrive/onedrive.module.js';
import { SharePointModule } from '../sharepoint/sharepoint.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [
    DocumentsModule,
    // Provides GoogleDriveOAuthService + GoogleDriveClientService.
    // KnowledgeIngestionService uses the client to download Drive
    // files at ingestion time; DriveImportService uses OAuth + client
    // for listing + import orchestration.
    GoogleDriveModule,
    // Provides the shared MicrosoftOAuthService that backs BOTH
    // SharePoint and OneDrive. The per-product import services
    // (SharePointImportService, OneDriveImportService) inject it
    // directly for token + status access.
    MicrosoftModule,
    // SharePoint-specific Graph wrapper for site/drive/folder
    // browsing; OAuth has moved to MicrosoftModule.
    SharePointModule,
    // OneDrive-specific Graph wrapper for /me/drive folder browsing;
    // shares the same MicrosoftModule OAuth as SharePoint.
    OneDriveModule,
    // Used by the ingestion path to drop a 'file_ingestion_failed'
    // notification when a file can't be chunked / embedded.
    NotificationsModule,
  ],
  controllers: [KnowledgeCoreController],
  providers: [
    KnowledgeCoreService,
    KnowledgeIngestionService,
    DriveImportService,
    SharePointImportService,
    OneDriveImportService,
  ],
  exports: [KnowledgeCoreService, KnowledgeIngestionService],
})
export class KnowledgeCoreModule {}
