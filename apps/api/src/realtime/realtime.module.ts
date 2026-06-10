import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { ChatGateway } from './chat.gateway.js';

/**
 * Realtime (WebSocket) infrastructure — presence + live message sync.
 * `JwtModule.register({})` gives the gateway a `JwtService` to verify
 * the handshake cookie (secret is passed explicitly per-verify).
 * `ConversationsModule` supplies the access check used on room join.
 */
@Module({
  imports: [JwtModule.register({}), ConversationsModule],
  providers: [ChatGateway],
  exports: [ChatGateway],
})
export class RealtimeModule {}
