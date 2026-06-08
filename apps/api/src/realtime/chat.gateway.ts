import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ConversationsService } from '../conversations/conversations.service.js';

/**
 * Realtime chat gateway (FA4). Two responsibilities:
 *
 *  1. **Presence** — a global, in-memory `userId -> socketIds` map. A
 *     user is "online" while they hold at least one socket (multiple
 *     tabs/devices collapse to one presence). Newcomers get the current
 *     online set; everyone else gets online/offline deltas. The FE
 *     turns this into the green dots on member avatars.
 *
 *  2. **Live message sync** — clients join a `conversation:<id>` room
 *     (after an access check) and receive `message:new` whenever another
 *     member's message is persisted, so a shared conversation updates
 *     without a manual refresh.
 *
 * Auth: the socket.io handshake carries the browser's cookies (the
 * client sets `withCredentials`), so we verify the same `access_token`
 * JWT the REST API uses. An unauthenticated/invalid handshake is
 * disconnected immediately.
 *
 * Scope (v1): single-instance, in-memory presence. Multi-instance
 * deployment would need the socket.io Redis adapter (ioredis is already
 * a dependency) so presence + rooms span processes — a follow-up.
 */
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private server!: Server;
  /** userId -> set of live socket ids. Presence = key has a non-empty set. */
  private readonly online = new Map<string, Set<string>>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly conversations: ConversationsService,
  ) {}

  private readCookie(header: string | undefined, name: string): string | null {
    if (!header) return null;
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === name) {
        return decodeURIComponent(part.slice(eq + 1).trim());
      }
    }
    return null;
  }

  handleConnection(client: Socket): void {
    let userId: string;
    try {
      const token = this.readCookie(
        client.handshake.headers.cookie,
        'access_token',
      );
      if (!token) throw new Error('missing access_token cookie');
      const payload = this.jwt.verify<{ sub: string }>(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
      userId = payload.sub;
    } catch {
      // Unauthenticated handshake — drop it.
      client.disconnect(true);
      return;
    }

    client.data.userId = userId;
    let sockets = this.online.get(userId);
    const wasOffline = !sockets || sockets.size === 0;
    if (!sockets) {
      sockets = new Set();
      this.online.set(userId, sockets);
    }
    sockets.add(client.id);

    // Hand the newcomer the full online set; tell everyone else only
    // about the transition (avoids rebroadcasting the whole set on
    // every connect).
    client.emit('presence:state', { online: [...this.online.keys()] });
    if (wasOffline) {
      client.broadcast.emit('presence:online', { userId });
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = client.data.userId as string | undefined;
    if (!userId) return;
    const sockets = this.online.get(userId);
    if (!sockets) return;
    sockets.delete(client.id);
    if (sockets.size === 0) {
      this.online.delete(userId);
      this.server.emit('presence:offline', { userId });
    }
  }

  @SubscribeMessage('conversation:join')
  async onJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<void> {
    const userId = client.data.userId as string | undefined;
    const conversationId = body?.conversationId;
    if (!userId || !conversationId) return;
    try {
      // Reuse the REST access gate: throws unless the user can read the
      // conversation (via project / team / direct membership).
      await this.conversations.findOne(conversationId, userId);
      await client.join(`conversation:${conversationId}`);
    } catch {
      // No access (or gone) — silently ignore; the socket just won't
      // receive that room's events.
    }
  }

  @SubscribeMessage('conversation:leave')
  onLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ): void {
    if (body?.conversationId) {
      void client.leave(`conversation:${body.conversationId}`);
    }
  }

  /**
   * Broadcast a newly-persisted message to the conversation room.
   * Called by the chat controller after a user / assistant message is
   * saved. `senderId` lets the FE skip a redundant refetch for the
   * author (who already has the message optimistically).
   */
  emitMessage(conversationId: string, senderId: string | null): void {
    if (!this.server) return;
    this.server
      .to(`conversation:${conversationId}`)
      .emit('message:new', { conversationId, senderId });
  }
}
