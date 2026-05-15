import { Module } from '@nestjs/common';
import { KnowledgeCoreController } from './knowledge-core.controller.js';
import { KnowledgeCoreService } from './knowledge-core.service.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';

@Module({
  imports: [
    DocumentsModule,
    // KeyResolverService for the OCR path in ingestOneFile — image
    // uploads route through OpenRouter using the uploader's key.
    OpenRouterModule,
    // Used by the ingestion path to drop a 'file_ingestion_failed'
    // notification when a file can't be chunked / embedded.
    NotificationsModule,
  ],
  controllers: [KnowledgeCoreController],
  providers: [KnowledgeCoreService, KnowledgeIngestionService],
  exports: [KnowledgeCoreService, KnowledgeIngestionService],
})
export class KnowledgeCoreModule {}
