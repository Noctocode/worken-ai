import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';
import { KnowledgeCoreModule } from '../knowledge-core/knowledge-core.module.js';
import { ModelsModule } from '../models/models.module.js';

@Module({
  // Models brings ModelsService — used to auto-provision a provider's
  // catalog into the Models tab when an onboarding BYOK key is saved.
  imports: [OpenRouterModule, KnowledgeCoreModule, ModelsModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
