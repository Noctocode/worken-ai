import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { KnowledgeCoreModule } from '../knowledge-core/knowledge-core.module.js';
import { ObservabilityModule } from '../observability/observability.module.js';
import { AiCronController } from './ai-cron.controller.js';
import { AiCronService } from './ai-cron.service.js';
import { CronRunnerService } from './cron-runner.service.js';
import { CronSchedulerService } from './cron-scheduler.service.js';
import { DeliveryService } from './delivery.service.js';

/**
 * AI Cron — recurring AI prompts scheduled by the user. CRUD + run history,
 * validate-cron preview, the non-BYOK cadence guardrail, the minute-tick
 * scanner (CronSchedulerService), and the runner (CronRunnerService) that
 * executes a claimed job through ChatService + knowledge-core RAG and records
 * the result. Delivery is a no-op stub here (real channels land in commit 7).
 * ScheduleModule.forRoot() is registered once in AppModule.
 */
@Module({
  imports: [
    IntegrationsModule, // ChatTransportService (routing + guardrail)
    ChatModule, // ChatService (model execution)
    KnowledgeCoreModule, // KnowledgeIngestionService (RAG retrieval)
    ObservabilityModule, // recordLLMCall
  ],
  controllers: [AiCronController],
  providers: [
    AiCronService,
    CronSchedulerService,
    CronRunnerService,
    DeliveryService,
  ],
  exports: [AiCronService],
})
export class AiCronModule {}
