import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [ConfigModule, DocumentsModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
