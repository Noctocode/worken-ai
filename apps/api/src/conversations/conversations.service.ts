import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, asc } from 'drizzle-orm';
import {
  conversations,
  messageFeedback,
  messages,
  projectMembers,
  projects,
  users,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { TeamsService } from '../teams/teams.service.js';

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly teamsService: TeamsService,
  ) {}

  /**
   * Verify the user can act on a project. Access sources (any one is
   * sufficient) — strictly additive over the legacy model:
   *  1. Project owner (`projects.user_id`).
   *  2. Member of the project's team (`projects.team_id` -> teams).
   *  3. Direct project membership (`project_members` row). The Figma
   *     invite modal (179:16073) "Other" group surfaces these — users
   *     pulled into a single chat from outside the project's team.
   *
   * Returns the project on success; throws NotFound (we deliberately
   * mask Forbidden as NotFound so callers can't enumerate IDs).
   */
  private async verifyProjectAccess(projectId: string, userId: string) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    if (project.userId === userId) return project;

    if (project.teamId) {
      const role = await this.teamsService.getUserTeamRole(
        project.teamId,
        userId,
      );
      if (role) return project;
    }

    // Fall through to the direct-membership table. One extra round-
    // trip on the miss-path only; team-member users hit the early
    // return above.
    const [directMember] = await this.db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
        ),
      )
      .limit(1);

    if (!directMember) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    return project;
  }

  /** Verify the user has access to a conversation (via its project). Returns the conversation. */
  private async verifyConversationAccess(
    conversationId: string,
    userId: string,
  ) {
    const [conversation] = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }

    await this.verifyProjectAccess(conversation.projectId, userId);
    return conversation;
  }

  async findByProject(projectId: string, userId: string) {
    await this.verifyProjectAccess(projectId, userId);

    const convos = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.projectId, projectId))
      .orderBy(desc(conversations.updatedAt));

    // For each conversation, get distinct participants from messages
    const result = await Promise.all(
      convos.map(async (convo) => {
        const participantRows = await this.db
          .selectDistinctOn([messages.userId], {
            userId: messages.userId,
            userName: users.name,
            userPicture: users.picture,
          })
          .from(messages)
          .innerJoin(users, eq(messages.userId, users.id))
          .where(
            and(
              eq(messages.conversationId, convo.id),
              // only user messages have userId set
            ),
          );

        return {
          ...convo,
          participants: participantRows.map((p) => ({
            id: p.userId,
            name: p.userName,
            picture: p.userPicture,
          })),
        };
      }),
    );

    return result;
  }

  async findOne(
    conversationId: string,
    userId: string,
  ): Promise<{
    id: string;
    projectId: string;
    userId: string;
    title: string | null;
    createdAt: Date;
    updatedAt: Date;
    messages: {
      id: string;
      role: string;
      content: string;
      metadata: unknown;
      createdAt: Date;
      userId: string | null;
      userName: string | null;
      userPicture: string | null;
    }[];
  }> {
    const conversation = await this.verifyConversationAccess(
      conversationId,
      userId,
    );

    const msgs = await this.db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        metadata: messages.metadata,
        createdAt: messages.createdAt,
        userId: messages.userId,
        userName: users.name,
        userPicture: users.picture,
      })
      .from(messages)
      .leftJoin(users, eq(messages.userId, users.id))
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));

    return {
      ...conversation,
      messages: msgs,
    };
  }

  async create(projectId: string, userId: string) {
    await this.verifyProjectAccess(projectId, userId);

    const [conversation] = await this.db
      .insert(conversations)
      .values({
        projectId,
        userId,
        title: null,
      })
      .returning();

    return conversation;
  }

  async addMessage(
    conversationId: string,
    role: string,
    content: string,
    userId: string | null,
    metadata?: unknown,
  ) {
    const [msg] = await this.db
      .insert(messages)
      .values({
        conversationId,
        role,
        content,
        userId,
        metadata: metadata ?? null,
      })
      .returning();

    // Update conversation updatedAt
    await this.db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));

    // Auto-set title from first user message
    if (role === 'user') {
      const [convo] = await this.db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId));

      if (convo && !convo.title) {
        // Truncate at word boundary around 80 chars
        let title = content;
        if (title.length > 80) {
          title = title.slice(0, 80);
          const lastSpace = title.lastIndexOf(' ');
          if (lastSpace > 40) {
            title = title.slice(0, lastSpace);
          }
          title += '...';
        }

        await this.db
          .update(conversations)
          .set({ title })
          .where(eq(conversations.id, conversationId));
      }
    }

    return msg;
  }

  async remove(conversationId: string, userId: string) {
    await this.verifyConversationAccess(conversationId, userId);

    await this.db
      .delete(conversations)
      .where(eq(conversations.id, conversationId));

    return { deleted: true };
  }

  /**
   * Persist a 👍 / 👎 vote on a single message.
   *
   * Access is gated on the user being a participant in the message's
   * project (same gate as reading the conversation). `score === null`
   * (or the caller toggling the same thumb twice on the FE) deletes
   * the row so aggregates stay simple — `sum(score)` skips un-voted
   * messages without NULL handling.
   */
  async submitFeedback(
    messageId: string,
    userId: string,
    score: 1 | -1 | null,
  ) {
    const [msg] = await this.db
      .select({ conversationId: messages.conversationId })
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1);
    if (!msg) {
      throw new NotFoundException(`Message ${messageId} not found`);
    }
    // Access check chains through the project's verifyProjectAccess.
    await this.verifyConversationAccess(msg.conversationId, userId);

    if (score === null) {
      await this.db
        .delete(messageFeedback)
        .where(
          and(
            eq(messageFeedback.messageId, messageId),
            eq(messageFeedback.userId, userId),
          ),
        );
      return { score: null };
    }

    if (score !== 1 && score !== -1) {
      throw new BadRequestException('score must be 1, -1, or null');
    }

    await this.db
      .insert(messageFeedback)
      .values({ messageId, userId, score })
      .onConflictDoUpdate({
        target: [messageFeedback.messageId, messageFeedback.userId],
        set: { score, updatedAt: new Date() },
      });

    return { score };
  }
}
