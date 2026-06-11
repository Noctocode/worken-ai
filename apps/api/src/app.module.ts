import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type Redis from 'ioredis';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtOrApiKeyGuard } from './auth/jwt-or-api-key.guard';
import { ChatModule } from './chat/chat.module';
import { CompareModelsModule } from './compare-models/compare-models.module';
import { ConfluenceModule } from './confluence/confluence.module';
import { ConversationsModule } from './conversations/conversations.module';
import { DatabaseModule } from './database/database.module';
import { DocumentsModule } from './documents/documents.module';
import { GoogleDriveModule } from './google-drive/google-drive.module';
import { GuardrailsSectionModule } from './guardrails/guardrails-section.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { KnowledgeCoreModule } from './knowledge-core/knowledge-core.module';
import { ProjectsModule } from './projects/projects.module';
import { RedisModule, REDIS } from './redis/redis.module';
import { ModelsModule } from './models/models.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ObservabilityModule } from './observability/observability.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { OneDriveModule } from './onedrive/onedrive.module';
import { OrgSettingsModule } from './org-settings/org-settings.module';
import { PromptsModule } from './prompts/prompts.module';
import { SharePointModule } from './sharepoint/sharepoint.module';
import { ShortcutsModule } from './shortcuts/shortcuts.module';
import { TeamsModule } from './teams/teams.module';
import { TendersModule } from './tenders/tenders.module';
import { UsersModule } from './users/users.module';
import { buildThrottlerOptions } from './throttler/throttler.options';

@Module({
  imports: [
    ConfigModule.forRoot({ envFilePath: '../../.env', isGlobal: true }),
    DatabaseModule,
    RedisModule,
    // Rate limiting for the public password-auth endpoints (issue #23).
    // Counters live in the shared Redis so they hold across API replicas
    // and survive restarts. The named throttlers + per-endpoint opt-in
    // live in src/throttler.
    ThrottlerModule.forRootAsync({
      inject: [REDIS],
      useFactory: (redis: Redis) =>
        buildThrottlerOptions(new ThrottlerStorageRedisService(redis)),
    }),
    ApiKeysModule,
    AuthModule,
    ChatModule,
    CompareModelsModule,
    ConfluenceModule,
    ConversationsModule,
    DocumentsModule,
    GoogleDriveModule,
    GuardrailsSectionModule,
    IntegrationsModule,
    KnowledgeCoreModule,
    ModelsModule,
    NotificationsModule,
    ObservabilityModule,
    OnboardingModule,
    OneDriveModule,
    OrgSettingsModule,
    ProjectsModule,
    PromptsModule,
    SharePointModule,
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
