import { Module } from '@nestjs/common';
import { KnowledgeCoreController } from './knowledge-core.controller.js';
import { KnowledgeCoreService } from './knowledge-core.service.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';
import { DocumentsModule } from '../documents/documents.module.js';

@Module({
  imports: [DocumentsModule],
  controllers: [KnowledgeCoreController],
  providers: [KnowledgeCoreService, KnowledgeIngestionService],
  exports: [KnowledgeCoreService, KnowledgeIngestionService],
})
export class KnowledgeCoreModule {}
