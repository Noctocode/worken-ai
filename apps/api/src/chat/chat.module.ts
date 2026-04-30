import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatService } from './chat.service.js';
import { ChatController } from './chat.controller.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';

@Module({
  imports: [
    ConfigModule,
    DocumentsModule,
    ConversationsModule,
    IntegrationsModule,
    OpenRouterModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
