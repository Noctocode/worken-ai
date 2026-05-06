import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtOrApiKeyGuard } from './auth/jwt-or-api-key.guard';
import { ChatModule } from './chat/chat.module';
import { CompareModelsModule } from './compare-models/compare-models.module';
import { ConversationsModule } from './conversations/conversations.module';
import { DatabaseModule } from './database/database.module';
import { DocumentsModule } from './documents/documents.module';
import { GuardrailsSectionModule } from './guardrails/guardrails-section.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { KnowledgeCoreModule } from './knowledge-core/knowledge-core.module';
import { ProjectsModule } from './projects/projects.module';
import { RedisModule } from './redis/redis.module';
import { ModelsModule } from './models/models.module';
import { ObservabilityModule } from './observability/observability.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PromptsModule } from './prompts/prompts.module';
import { ShortcutsModule } from './shortcuts/shortcuts.module';
import { TeamsModule } from './teams/teams.module';
import { TendersModule } from './tenders/tenders.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ envFilePath: '../../.env', isGlobal: true }),
    DatabaseModule,
    RedisModule,
    ApiKeysModule,
    AuthModule,
    ChatModule,
    CompareModelsModule,
    ConversationsModule,
    DocumentsModule,
    GuardrailsSectionModule,
    IntegrationsModule,
    KnowledgeCoreModule,
    ModelsModule,
    ObservabilityModule,
    OnboardingModule,
    ProjectsModule,
    PromptsModule,
    ShortcutsModule,
    TeamsModule,
    TendersModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtOrApiKeyGuard,
    },
  ],
})
export class AppModule {}
