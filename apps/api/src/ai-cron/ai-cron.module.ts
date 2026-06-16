import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { AiCronController } from './ai-cron.controller.js';
import { AiCronService } from './ai-cron.service.js';

/**
 * AI Cron — recurring AI prompts scheduled by the user. This commit wires up
 * CRUD + run history + the validate-cron preview and the non-BYOK cadence
 * guardrail (which needs ChatTransportService to know how a model routes).
 * The minute-tick scanner, runner, and delivery land in later commits;
 * ScheduleModule.forRoot() is registered once in AppModule.
 */
@Module({
  imports: [IntegrationsModule],
  controllers: [AiCronController],
  providers: [AiCronService],
  exports: [AiCronService],
})
export class AiCronModule {}
