import { Module } from '@nestjs/common';
import { GuardrailsSectionController } from './guardrails-section.controller.js';
import { GuardrailsSectionService } from './guardrails-section.service.js';
import { TeamsModule } from '../teams/teams.module.js';

@Module({
  imports: [TeamsModule],
  controllers: [GuardrailsSectionController],
  providers: [GuardrailsSectionService],
  exports: [GuardrailsSectionService],
})
export class GuardrailsSectionModule {}
