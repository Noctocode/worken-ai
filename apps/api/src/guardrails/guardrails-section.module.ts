import { Module } from '@nestjs/common';
import { GuardrailEvaluatorService } from './guardrail-evaluator.service.js';
import { GuardrailsSectionController } from './guardrails-section.controller.js';
import { GuardrailsSectionService } from './guardrails-section.service.js';
import { TeamsModule } from '../teams/teams.module.js';

@Module({
  imports: [TeamsModule],
  controllers: [GuardrailsSectionController],
  providers: [GuardrailsSectionService, GuardrailEvaluatorService],
  // Evaluator is consumed by ChatModule + CompareModelsModule, so
  // it's exported alongside the section CRUD service.
  exports: [GuardrailsSectionService, GuardrailEvaluatorService],
})
export class GuardrailsSectionModule {}
