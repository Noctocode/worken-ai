import { Module } from '@nestjs/common';
import { KnowledgeCoreController } from './knowledge-core.controller.js';
import { KnowledgeCoreService } from './knowledge-core.service.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [
    DocumentsModule,
    // Used by the ingestion path to drop a 'file_ingestion_failed'
    // notification when a file can't be chunked / embedded.
    NotificationsModule,
  ],
  controllers: [KnowledgeCoreController],
  providers: [KnowledgeCoreService, KnowledgeIngestionService],
  exports: [KnowledgeCoreService, KnowledgeIngestionService],
})
export class KnowledgeCoreModule {}
