import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  notifications,
  teamMembers,
  teams,
  users,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';

/**
 * Discriminated `type` values the FE knows how to render. Loose-
 * typed in the DB on purpose so a new type can be added without a
 * migration, but kept as a TS union here so the wire-in points get
 * compile-time coverage.
 */
export type NotificationType =
  | 'team_invite'
  | 'org_invite'
  | 'budget_alert'
  | 'budget_changed'
  | 'team_renamed'
  | 'team_role_changed'
  | 'team_member_added'
  | 'team_member_removed'
  | 'team_deleted'
  | 'account_role_changed'
  | 'account_budget_changed'
  | 'member_cap_changed'
  | 'file_ingestion_failed'
  | 'project_created'
  | 'project_deleted'
  | 'guardrail_added';

export type NotificationStatus = 'pending' | 'acted' | 'dismissed';

/**
 * Shape returned to the FE. `data` is intentionally loose — each
 * type carries its own payload (team invite: invitationToken /
 * memberId / teamName; budget alert: threshold / scope / period).
 */
export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  status: NotificationStatus;
  readAt: string | null;
  createdAt: string;
}

/**
 * Standalone enqueue surface used by other services (teams, users,
 * chat-transport) to drop a notification onto a user's inbox.
 * Kept narrow: callers don't pick status, readAt, etc — those are
 * lifecycle, not input.
 */
export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Insert a single notification. Returns the new row so callers
   * have the id for tests / audit logs. Failures (eg DB down) are
   * logged but NOT thrown — a missed in-app notification shouldn't
   * abort the parent action (invite, chat call). Email remains as
   * the backup channel anyway.
   */
  async create(input: CreateNotificationInput): Promise<NotificationView | null> {
    try {
      const [row] = await this.db
        .insert(notifications)
        .values({
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          data: input.data ?? {},
        })
        .returning();
      return this.toView(row);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to create notification (type=${input.type}, user=${input.userId}): ${msg}`,
      );
      return null;
    }
  }

  /**
   * Budget-alert-specific enqueue that dedupes on a synthetic
   * `thresholdKey` carried in `data` (eg "2026-05:org:80"). Two
   * concurrent chat calls crossing the same threshold both run
   * `create` here; the SELECT-then-INSERT race window is small
   * enough that an occasional duplicate is acceptable — worst case
   * the user sees one notif row twice. Cheaper than a partial
   * unique index, simpler than an advisory lock.
   */
  async createIfNotExists(input: CreateNotificationInput & {
    data: Record<string, unknown> & { thresholdKey: string };
  }): Promise<NotificationView | null> {
    try {
      const existing = await this.db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, input.userId),
            eq(notifications.type, input.type),
            sql`${notifications.data} ->> 'thresholdKey' = ${input.data.thresholdKey}`,
          ),
        )
        .limit(1);
      if (existing.length > 0) return null;
      return await this.create(input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to dedupe notification (type=${input.type}, user=${input.userId}, threshold=${input.data.thresholdKey}): ${msg}`,
      );
      return null;
    }
  }

  /**
   * Default list: pending + acted (recent), newest first, capped at
   * 50. Dismissed rows are filtered out entirely — they're meant to
   * disappear from the user's view. Recipients only — callers never
   * peek at someone else's inbox.
   */
  async findForUser(userId: string): Promise<NotificationView[]> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          sql`${notifications.status} != 'dismissed'`,
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    return rows.map((r) => this.toView(r));
  }

  /**
   * Unread count = pending OR acted with read_at IS NULL. Drives
   * the sidebar badge.
   */
  async unreadCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          sql`${notifications.status} != 'dismissed'`,
          isNull(notifications.readAt),
        ),
      );
    return row?.count ?? 0;
  }

  async markRead(id: string, userId: string): Promise<NotificationView> {
    const [row] = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(notifications.id, id), eq(notifications.userId, userId)),
      )
      .returning();
    if (!row) throw new NotFoundException('Notification not found');
    return this.toView(row);
  }

  async markAllRead(userId: string): Promise<{ markedCount: number }> {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    return { markedCount: rows.length };
  }

  async dismiss(id: string, userId: string): Promise<{ id: string }> {
    const [row] = await this.db
      .update(notifications)
      .set({ status: 'dismissed' })
      .where(
        and(eq(notifications.id, id), eq(notifications.userId, userId)),
      )
      .returning({ id: notifications.id });
    if (!row) throw new NotFoundException('Notification not found');
    return row;
  }

  /**
   * Look up a notification scoped to the caller. Throws 404 if it
   * doesn't exist or belongs to someone else.
   */
  async getForCaller(id: string, userId: string) {
    const [row] = await this.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.id, id), eq(notifications.userId, userId)),
      );
    if (!row) throw new NotFoundException('Notification not found');
    return row;
  }

  /**
   * Flip a notification to status='acted'. Used by the
   * controller after delegating the real accept/decline work
   * (which lives in the owning service — TeamsService for team
   * invites) so business logic stays where it already is.
   */
  async markActed(id: string, userId: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ status: 'acted', readAt: new Date() })
      .where(
        and(eq(notifications.id, id), eq(notifications.userId, userId)),
      );
  }

  /**
   * Decline a team invite — revoke the pending team_members row so
   * the inviter sees the decline reflected in their pending list,
   * then flip the notification to 'acted'. The invitee acts on
   * their own row here; no team-owner gate (it's their inbox).
   */
  async declineTeamInvite(id: string, userId: string): Promise<{ ok: true }> {
    const row = await this.getForCaller(id, userId);
    if (row.status !== 'pending') {
      throw new BadRequestException(
        'This notification has already been resolved.',
      );
    }
    if (row.type !== 'team_invite') {
      throw new BadRequestException(
        `Notifications of type '${row.type}' don't support Decline.`,
      );
    }
    const data = (row.data ?? {}) as Record<string, unknown>;
    const memberId = typeof data.memberId === 'string' ? data.memberId : null;
    if (memberId) {
      // Defense-in-depth: scope the UPDATE to a row that actually
      // belongs to the caller (email match) and is still actionable
      // (status='pending', invitationStatus pending/null). Without
      // this, a wrong memberId in notification.data would revoke an
      // unrelated row. If the invite was already resolved elsewhere
      // (owner revoked, expired) the update is a no-op and we still
      // flip the notification to 'acted' so the inbox clears.
      const [caller] = await this.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId));
      if (caller?.email) {
        await this.db
          .update(teamMembers)
          .set({
            invitationStatus: 'revoked',
            invitationRevokedAt: new Date(),
            invitationToken: null,
          })
          .where(
            and(
              eq(teamMembers.id, memberId),
              eq(teamMembers.email, caller.email),
              eq(teamMembers.status, 'pending'),
              or(
                isNull(teamMembers.invitationStatus),
                eq(teamMembers.invitationStatus, 'pending'),
              ),
            ),
          );
      }
    }
    await this.markActed(id, userId);
    return { ok: true };
  }

  /**
   * Resolve the set of users who should receive a team-wide
   * informational notification (rename, generic announcements):
   * team owner + every accepted member regardless of role.
   * Distinct from `getTeamBudgetRecipients` which is narrower
   * (owner + admin only) because budget signals are management-
   * oriented, not member-oriented.
   */
  async getTeamMembers(teamId: string): Promise<string[]> {
    const ownerRow = await this.db
      .select({ ownerId: teams.ownerId })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    const owner = ownerRow[0]?.ownerId;
    const memberRows = await this.db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.status, 'accepted'),
        ),
      );
    const set = new Set<string>();
    if (owner) set.add(owner);
    for (const r of memberRows) {
      if (r.userId) set.add(r.userId);
    }
    return Array.from(set);
  }

  /**
   * Resolve the set of users who should receive a team-budget
   * alert: team owner + every accepted member with role='admin'
   * or role='manager' (the owner-equivalent set). Used by the
   * chat-transport budget gates.
   */
  async getTeamBudgetRecipients(teamId: string): Promise<string[]> {
    const ownerRow = await this.db
      .select({ ownerId: teams.ownerId })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    const owner = ownerRow[0]?.ownerId;
    const adminRows = await this.db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          inArray(teamMembers.role, ['admin', 'manager']),
          eq(teamMembers.status, 'accepted'),
        ),
      );
    const set = new Set<string>();
    if (owner) set.add(owner);
    for (const r of adminRows) {
      if (r.userId) set.add(r.userId);
    }
    return Array.from(set);
  }

  /**
   * Every user in the caller's company. Used by transparency-style
   * notifications (org-wide guardrail added, etc) where the audience
   * is the whole org, not just admins. Excludes the caller; if the
   * caller has no company_name (personal profile), returns empty.
   */
  async getCompanyUsers(callerUserId: string): Promise<string[]> {
    const callerRow = await this.db
      .select({ companyName: users.companyName })
      .from(users)
      .where(eq(users.id, callerUserId))
      .limit(1);
    const companyName = callerRow[0]?.companyName ?? null;
    if (!companyName) return [];
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.companyName, companyName));
    return rows.map((r) => r.id).filter((id) => id !== callerUserId);
  }

  /**
   * Resolve the set of users who should receive an org-budget
   * alert: every accepted org admin. Multi-tenant scoping uses the
   * caller's company_name so we don't page admins of other tenants.
   */
  async getOrgBudgetRecipients(callerUserId: string): Promise<string[]> {
    const callerRow = await this.db
      .select({ companyName: users.companyName })
      .from(users)
      .where(eq(users.id, callerUserId))
      .limit(1);
    const companyName = callerRow[0]?.companyName ?? null;
    if (!companyName) return [];
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.role, 'admin'),
          eq(users.companyName, companyName),
        ),
      );
    return rows.map((r) => r.id);
  }

  private toView(row: typeof notifications.$inferSelect): NotificationView {
    return {
      id: row.id,
      type: row.type as NotificationType,
      title: row.title,
      body: row.body,
      data: (row.data ?? {}) as Record<string, unknown>,
      status: row.status as NotificationStatus,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
