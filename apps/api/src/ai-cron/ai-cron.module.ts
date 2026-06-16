import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { AiCronController } from './ai-cron.controller.js';
import { AiCronService } from './ai-cron.service.js';
import { CronSchedulerService } from './cron-scheduler.service.js';

/**
 * AI Cron — recurring AI prompts scheduled by the user. CRUD + run history +
 * the validate-cron preview and non-BYOK cadence guardrail (which needs
 * ChatTransportService to know how a model routes), plus the minute-tick
 * scanner (CronSchedulerService) that claims due jobs and advances their
 * schedule. The runner + delivery land in later commits;
 * ScheduleModule.forRoot() is registered once in AppModule.
 */
@Module({
  imports: [IntegrationsModule],
  controllers: [AiCronController],
  providers: [AiCronService, CronSchedulerService],
  exports: [AiCronService],
})
export class AiCronModule {}
