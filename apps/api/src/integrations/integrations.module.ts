import { Module } from '@nestjs/common';
import { AnthropicClientService } from './anthropic-client.service.js';
import { ChatTransportService } from './chat-transport.service.js';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationsService } from './integrations.service.js';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';

@Module({
  imports: [OpenRouterModule], // EncryptionService + KeyResolverService
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    ChatTransportService,
    AnthropicClientService,
  ],
  exports: [
    IntegrationsService,
    ChatTransportService,
    AnthropicClientService,
  ],
})
export class IntegrationsModule {}
