import { Module } from '@nestjs/common';
import { AnthropicClientService } from './anthropic-client.service.js';
import { ChatTransportService } from './chat-transport.service.js';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationsService } from './integrations.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';

@Module({
  // OpenRouter brings EncryptionService + KeyResolverService;
  // Notifications brings NotificationsService used by the budget
  // gates for threshold alerts.
  imports: [OpenRouterModule, NotificationsModule],
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
