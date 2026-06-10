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
 * Realtime chat gateway (FA4). Responsibilities:
 *
 *  1. **Presence** — an in-memory `userId -> { sockets, companyId }` map.
 *     A user is "online" while they hold at least one socket. Presence
 *     is **tenant-scoped**: broadcasts and the initial state only reach
 *     the user's own company (a personal profile, companyId === null, is
 *     a tenant of one and only ever sees itself) — no cross-tenant
 *     online-list leakage. The FE turns this into green member dots.
 *
 *  2. **Live message sync** — clients join a `conversation:<id>` room
 *     (access-checked) and receive `message:new` when another member's
 *     message is persisted. Clients also join `project:<id>` to get
 *     `project:activity` (new message / conversation in the project) so
 *     the conversation sidebar refreshes without a manual reload.
 *
 * Auth: the socket.io handshake carries the browser cookies (client sets
 * `withCredentials`), so we verify the same `access_token` JWT the REST
 * API uses. Invalid handshakes are disconnected.
 *
 * Scope (v1): single-instance, in-memory. Multi-instance needs the
 * socket.io Redis adapter (ioredis is already a dependency).
 */
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private server!: Server;
  /** userId -> live sockets + tenant. Presence = key has a non-empty set. */
  private readonly online = new Map<
    string,
    { sockets: Set<string>; companyId: string | null }
  >();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly conversations: ConversationsService,
  ) {}

  /** Presence broadcast scope: the company for company users, the lone
   *  user for personal profiles (so all null-company users don't pool). */
  private presenceRoom(companyId: string | null, userId: string): string {
    return companyId ? `company:${companyId}` : `user:${userId}`;
  }

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

  async handleConnection(client: Socket): Promise<void> {
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
      client.disconnect(true);
      return;
    }

    const companyId = await this.conversations.getUserCompanyId(userId);
    // The socket may have been torn down during the async lookup.
    if (client.disconnected) return;

    client.data.userId = userId;
    client.data.companyId = companyId;
    const room = this.presenceRoom(companyId, userId);
    await client.join(room);

    let entry = this.online.get(userId);
    const wasOffline = !entry || entry.sockets.size === 0;
    if (!entry) {
      entry = { sockets: new Set(), companyId };
      this.online.set(userId, entry);
    }
    entry.sockets.add(client.id);

    // Initial state: only userIds in the same tenant (personal → self).
    const scopedOnline = companyId
      ? [...this.online.entries()]
          .filter(([, v]) => v.companyId === companyId)
          .map(([uid]) => uid)
      : [userId];
    client.emit('presence:state', { online: scopedOnline });

    // Notify same-tenant peers only on the offline→online transition.
    if (wasOffline) {
      client.to(room).emit('presence:online', { userId });
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = client.data.userId as string | undefined;
    if (!userId) return;
    const entry = this.online.get(userId);
    if (!entry) return;
    entry.sockets.delete(client.id);
    if (entry.sockets.size === 0) {
      this.online.delete(userId);
      const companyId = client.data.companyId as string | null;
      this.server
        .to(this.presenceRoom(companyId, userId))
        .emit('presence:offline', { userId });
    }
  }

  @SubscribeMessage('conversation:join')
  async onJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<void> {
    const userId = client.data.userId as string | undefined;
    const conversationId = body?.conversationId;
    if (!userId || !conversationId) return;
    if (
      await this.conversations.canAccessConversation(conversationId, userId)
    ) {
      await client.join(`conversation:${conversationId}`);
    }
  }

  @SubscribeMessage('conversation:leave')
  onLeaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ): void {
    if (body?.conversationId) {
      void client.leave(`conversation:${body.conversationId}`);
    }
  }

  @SubscribeMessage('project:join')
  async onJoinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { projectId?: string },
  ): Promise<void> {
    const userId = client.data.userId as string | undefined;
    const projectId = body?.projectId;
    if (!userId || !projectId) return;
    if (await this.conversations.canAccessProject(projectId, userId)) {
      await client.join(`project:${projectId}`);
    }
  }

  @SubscribeMessage('project:leave')
  onLeaveProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { projectId?: string },
  ): void {
    if (body?.projectId) {
      void client.leave(`project:${body.projectId}`);
    }
  }

  /**
   * Broadcast a newly-persisted message to the conversation room.
   * `senderId` lets the FE skip a redundant refetch for the author.
   */
  emitMessage(conversationId: string, senderId: string | null): void {
    if (!this.server) return;
    this.server
      .to(`conversation:${conversationId}`)
      .emit('message:new', { conversationId, senderId });
  }

  /**
   * Signal that a project's conversation list changed (new message or
   * new conversation) so members viewing the sidebar refetch it.
   */
  emitProjectActivity(projectId: string): void {
    if (!this.server) return;
    this.server
      .to(`project:${projectId}`)
      .emit('project:activity', { projectId });
  }
}
