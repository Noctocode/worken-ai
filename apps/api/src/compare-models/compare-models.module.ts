import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CompareModelsController } from './compare-models.controller.js';
import { CompareModelsService } from './compare-models.service.js';
import { ChatModule } from '../chat/chat.module.js';
import { GuardrailsSectionModule } from '../guardrails/guardrails-section.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { KnowledgeCoreModule } from '../knowledge-core/knowledge-core.module.js';
import { ModelsModule } from '../models/models.module.js';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { SkillsModule } from '../skills/skills.module.js';

@Module({
  imports: [
    ConfigModule,
    ChatModule, // ChatService.sendMessageStream for arena fan-out
    GuardrailsSectionModule, // GuardrailEvaluatorService for arena runs
    IntegrationsModule,
    KnowledgeCoreModule, // KnowledgeIngestionService for RAG over user uploads
    ModelsModule,
    OpenRouterModule,
    DocumentsModule, // DocumentsService.embed — one query vector per run
    SkillsModule, // SkillRouterService for per-question skill selection
  ],
  controllers: [CompareModelsController],
  providers: [CompareModelsService],
})
export class CompareModelsModule {}
