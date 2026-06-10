import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, asc, ilike, or } from 'drizzle-orm';
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

    // A 'personal' conversation is private to its creator even within a
    // shared (team) project — project access alone isn't enough. 'team'
    // conversations stay visible to anyone with project access. Throw
    // NotFound (not Forbidden) so we don't leak that the id exists.
    if (conversation.scope === 'personal' && conversation.userId !== userId) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }
    return conversation;
  }

  /**
   * Lightweight access checks for the realtime gateway — boolean,
   * no message loading. Reuse the same gates as the REST endpoints.
   */
  async canAccessConversation(
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    try {
      await this.verifyConversationAccess(conversationId, userId);
      return true;
    } catch {
      return false;
    }
  }

  async canAccessProject(projectId: string, userId: string): Promise<boolean> {
    try {
      await this.verifyProjectAccess(projectId, userId);
      return true;
    } catch {
      return false;
    }
  }

  /** Tenant of the user, for scoping realtime presence. Null = personal. */
  async getUserCompanyId(userId: string): Promise<string | null> {
    const [u] = await this.db
      .select({ companyId: users.companyId })
      .from(users)
      .where(eq(users.id, userId));
    return u?.companyId ?? null;
  }

  async findByProject(projectId: string, userId: string, query?: string) {
    await this.verifyProjectAccess(projectId, userId);

    // Visibility: team conversations are shared with everyone who can
    // access the project; personal ones are private to their creator.
    const visibleToCaller = and(
      eq(conversations.projectId, projectId),
      or(eq(conversations.scope, 'team'), eq(conversations.userId, userId)),
    );

    let convos = await this.db
      .select()
      .from(conversations)
      .where(visibleToCaller)
      .orderBy(desc(conversations.updatedAt));

    // Optional server-side search: a conversation matches when its
    // title OR any of its messages' content contains the term (case-
    // insensitive). We resolve the matching ids in one ILIKE query
    // and filter the already-ordered list in memory, preserving the
    // updatedAt ordering. LIKE wildcards in the user term are escaped
    // so a literal `%`/`_` can't widen the match.
    const term = query?.trim();
    if (term) {
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const matches = await this.db
        .selectDistinct({ id: conversations.id })
        .from(conversations)
        .leftJoin(messages, eq(messages.conversationId, conversations.id))
        .where(
          and(
            visibleToCaller,
            or(ilike(conversations.title, like), ilike(messages.content, like)),
          ),
        );
      const matchedIds = new Set(matches.map((m) => m.id));
      convos = convos.filter((c) => matchedIds.has(c.id));
    }

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
    context: string | null;
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

  async create(
    projectId: string,
    userId: string,
    scope: 'personal' | 'team' = 'personal',
  ) {
    const project = await this.verifyProjectAccess(projectId, userId);

    // Only a team project can host a 'team' (shared) conversation; a
    // personal project has no team to share with, so coerce to personal.
    const effectiveScope: 'personal' | 'team' =
      project.teamId && scope === 'team' ? 'team' : 'personal';

    const [conversation] = await this.db
      .insert(conversations)
      .values({
        projectId,
        userId,
        title: null,
        scope: effectiveScope,
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

  /**
   * Update a conversation's free-form Chat Context (right-panel "Edit
   * Context"). Access is gated on project membership — any member who
   * can read the conversation can edit its shared context. Trims and
   * normalises empty/whitespace-only input to null so the panel can
   * fall back to its empty state. Returns the new value.
   */
  async updateContext(
    conversationId: string,
    userId: string,
    context: string | null,
  ) {
    await this.verifyConversationAccess(conversationId, userId);

    const trimmed =
      typeof context === 'string' && context.trim().length > 0
        ? context.trim()
        : null;

    await this.db
      .update(conversations)
      .set({ context: trimmed, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));

    return { context: trimmed };
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
