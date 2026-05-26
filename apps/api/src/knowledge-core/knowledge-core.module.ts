import { Module } from '@nestjs/common';
import { KnowledgeCoreController } from './knowledge-core.controller.js';
import { KnowledgeCoreService } from './knowledge-core.service.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';
import { DriveImportService } from './drive-import.service.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { GoogleDriveModule } from '../google-drive/google-drive.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [
    DocumentsModule,
    // Provides GoogleDriveOAuthService + GoogleDriveClientService.
    // KnowledgeIngestionService uses the client to download Drive
    // files at ingestion time; DriveImportService uses OAuth + client
    // for listing + import orchestration.
    GoogleDriveModule,
    // Used by the ingestion path to drop a 'file_ingestion_failed'
    // notification when a file can't be chunked / embedded.
    NotificationsModule,
  ],
  controllers: [KnowledgeCoreController],
  providers: [
    KnowledgeCoreService,
    KnowledgeIngestionService,
    DriveImportService,
  ],
  exports: [KnowledgeCoreService, KnowledgeIngestionService],
})
export class KnowledgeCoreModule {}
