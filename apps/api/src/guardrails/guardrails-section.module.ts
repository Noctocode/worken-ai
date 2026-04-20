import { Module } from '@nestjs/common';
import { GuardrailsSectionController } from './guardrails-section.controller.js';
import { GuardrailsSectionService } from './guardrails-section.service.js';

@Module({
  controllers: [GuardrailsSectionController],
  providers: [GuardrailsSectionService],
  exports: [GuardrailsSectionService],
})
export class GuardrailsSectionModule {}
