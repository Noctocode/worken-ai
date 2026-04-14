import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';

@Module({
  imports: [OpenRouterModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
