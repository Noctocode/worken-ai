import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatService } from './chat.service.js';
import { ChatController } from './chat.controller.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { GuardrailsSectionModule } from '../guardrails/guardrails-section.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { KnowledgeCoreModule } from '../knowledge-core/knowledge-core.module.js';
import { ModelsModule } from '../models/models.module.js';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';

@Module({
  imports: [
    ConfigModule,
    DocumentsModule,
    ConversationsModule,
    GuardrailsSectionModule, // GuardrailEvaluatorService for input/output gate
    IntegrationsModule,
    KnowledgeCoreModule, // KnowledgeIngestionService for user-scoped RAG
    ModelsModule,
    OpenRouterModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
  // CompareModelsModule consumes ChatService.sendMessageStream for the
  // arena fan-out so it doesn't need a parallel streaming primitive.
  exports: [ChatService],
})
export class ChatModule {}
