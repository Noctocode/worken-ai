import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatService } from './chat.service.js';
import { ChatController } from './chat.controller.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { ConversationsModule } from '../conversations/conversations.module.js';

@Module({
  imports: [ConfigModule, DocumentsModule, ConversationsModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
