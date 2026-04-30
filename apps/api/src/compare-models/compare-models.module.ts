import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CompareModelsController } from './compare-models.controller.js';
import { CompareModelsService } from './compare-models.service.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';

@Module({
  imports: [ConfigModule, IntegrationsModule, OpenRouterModule],
  controllers: [CompareModelsController],
  providers: [CompareModelsService],
})
export class CompareModelsModule {}
