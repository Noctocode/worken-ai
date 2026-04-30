import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationsService } from './integrations.service.js';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';

@Module({
  imports: [OpenRouterModule], // brings in EncryptionService
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
