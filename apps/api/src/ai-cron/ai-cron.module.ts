import { Module } from '@nestjs/common';
import { AiCronController } from './ai-cron.controller.js';
import { AiCronService } from './ai-cron.service.js';

/**
 * AI Cron — recurring AI prompts scheduled by the user. This commit wires up
 * CRUD + run history. The minute-tick scanner, runner, and delivery land in
 * later commits; ScheduleModule.forRoot() is registered once in AppModule.
 */
@Module({
  controllers: [AiCronController],
  providers: [AiCronService],
  exports: [AiCronService],
})
export class AiCronModule {}
