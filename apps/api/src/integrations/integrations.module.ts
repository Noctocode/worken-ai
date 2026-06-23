import { Module } from '@nestjs/common';
import { AnthropicClientService } from './anthropic-client.service.js';
import { ChatTransportService } from './chat-transport.service.js';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationsService } from './integrations.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';
import { ModelsModule } from '../models/models.module.js';

@Module({
  // OpenRouter brings EncryptionService + KeyResolverService;
  // Notifications brings NotificationsService used by the budget gates
  // for threshold alerts; Models brings ModelsService used to auto-
  // provision a provider's catalog into the Models tab when its key is
  // toggled on/off.
  imports: [OpenRouterModule, NotificationsModule, ModelsModule],
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    ChatTransportService,
    AnthropicClientService,
  ],
  exports: [IntegrationsService, ChatTransportService, AnthropicClientService],
})
export class IntegrationsModule {}
