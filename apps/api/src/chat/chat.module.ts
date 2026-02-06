import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

@Module({
  imports: [ConfigModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
