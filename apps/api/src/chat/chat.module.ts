import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatService } from './chat.service.js';
import { ChatController } from './chat.controller.js';
import { ModelSuggestionService } from './model-suggestion.service.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { ArsoModule } from '../arso/arso.module.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { GuardrailsSectionModule } from '../guardrails/guardrails-section.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { KnowledgeCoreModule } from '../knowledge-core/knowledge-core.module.js';
import { ModelsModule } from '../models/models.module.js';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { SkillsModule } from '../skills/skills.module.js';

@Module({
  imports: [
    ConfigModule,
    ArsoModule, // ArsoToolsService for the chat tool-loop (ARSO function calling)
    DocumentsModule,
    ConversationsModule,
    RealtimeModule, // ChatGateway for presence + live message sync
    GuardrailsSectionModule, // GuardrailEvaluatorService for input/output gate
    IntegrationsModule,
    KnowledgeCoreModule, // KnowledgeIngestionService for user-scoped RAG
    ModelsModule,
    OpenRouterModule,
    ProjectsModule, // ProjectKnowledgeService for project-attached KC RAG
    SkillsModule, // SkillRouterService for per-turn skill selection
  ],
  controllers: [ChatController],
  providers: [ChatService, ModelSuggestionService],
  // CompareModelsModule consumes ChatService.sendMessageStream for the
  // arena fan-out so it doesn't need a parallel streaming primitive.
  exports: [ChatService],
})
export class ChatModule {}
