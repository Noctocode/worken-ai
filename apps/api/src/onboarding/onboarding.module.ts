import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';
import { KnowledgeCoreModule } from '../knowledge-core/knowledge-core.module.js';

@Module({
  imports: [OpenRouterModule, KnowledgeCoreModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
