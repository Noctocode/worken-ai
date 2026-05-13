import {
  BadRequestException,
  ConflictException,
  forwardRef,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';

const INVITE_EXPIRY_DAYS = 7;
const inviteExpiry = () =>
  new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
import {
  teams,
  teamMembers,
  users,
  guardrails,
  guardrailTeams,
  integrations,
  modelConfigs,
  observabilityEvents,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EncryptionService } from '../openrouter/encryption.service.js';
import { OpenRouterProvisioningService } from '../openrouter/openrouter-provisioning.service.js';
import {
  PREDEFINED_PROVIDERS,
  isPredefinedProvider,
} from '../integrations/predefined-providers.js';
import type { IntegrationView } from '../integrations/integrations.service.js';

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly mailService: MailService,
    private readonly provisioningService: OpenRouterProvisioningService,
    private readonly encryptionService: EncryptionService,
    // forwardRef matches the module-level cycle break — see
    // TeamsModule for the matching forwardRef on NotificationsModule.
    @Inject(forwardRef(() => NotificationsService))
    private readonly notifications: NotificationsService,
  ) {}

  async create(
    name: string,
    userId: string,
    email: string,
    description?: string,
    monthlyBudgetCents?: number,
    parentTeamId?: string,
  ) {
    // Subteams inherit the parent's management gate: only owners or
    // editors of the parent can create children.
    if (parentTeamId) {
      const parentRole = await this.getUserTeamRole(parentTeamId, userId);
      if (
        parentRole !== 'owner' &&
        parentRole !== 'admin' &&
        parentRole !== 'manager' &&
        parentRole !== 'editor'
      ) {
        throw new ForbiddenException(
          'Only team owners, admins, managers, or editors can add subteams',
        );
      }
    }

    const budgetCents = monthlyBudgetCents ?? 1000;
    const [team] = await this.db
      .insert(teams)
      .values({
        name,
        description: description ?? null,
        ownerId: userId,
        parentTeamId: parentTeamId ?? null,
        monthlyBudgetCents: budgetCents,
      })
      .returning() as typeof teams.$inferSelect[];

    // Auto-add owner as accepted member with owner role
    await this.db.insert(teamMembers).values({
      teamId: team.id,
      userId,
      email,
      role: 'owner',
      status: 'accepted',
    });

    // Provision OpenRouter key for this team. Best-effort: if it fails, the
    // team still exists in DB but with a null openrouterKeyId — chat calls
    // in that team will fail until the key is re-provisioned (which now
    // happens automatically the next time the owner saves a budget; see
    // updateBudget below).
    //
    // Floor at $0.01 when the admin explicitly creates a team with a
    // 0-budget (suspended state). Same rationale as users.service /
    // teams.service.updateBudget: OpenRouter's behaviour for `limit:
    // 0` is undocumented, so we never send it. The chat-time gate
    // (`assertManagedBudgetApproved`) blocks all calls regardless;
    // the floor is defense-in-depth in case the gate is ever
    // bypassed.
    const budgetUsd = budgetCents / 100;
    const upstreamLimitUsd = budgetUsd === 0 ? 0.01 : budgetUsd;
    try {
      const { key, hash } = await this.provisioningService.createKey(
        `team-${team.id}`,
        upstreamLimitUsd,
      );
      const encrypted = this.encryptionService.encrypt(key);
      await this.db
        .update(teams)
        .set({
          openrouterKeyId: hash,
          openrouterKeyEncrypted: encrypted,
        })
        .where(eq(teams.id, team.id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to provision OpenRouter key for team ${team.id} ("${name}"): ${msg}`,
      );
    }

    return team;
  }

  async update(
    teamId: string,
    userId: string,
    data: { name?: string; description?: string },
  ) {
    const [team] = await this.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId));

    if (!team) {
      throw new NotFoundException('Team not found');
    }
    const updateCallerRole = await this.getUserTeamRole(teamId, userId);
    if (
      updateCallerRole !== 'owner' &&
      updateCallerRole !== 'admin' &&
      updateCallerRole !== 'manager' &&
      updateCallerRole !== 'editor'
    ) {
      throw new ForbiddenException(
        'Only team owners, admins, managers, or editors can update the team',
      );
    }

    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined)
      updates.description = data.description || null;

    if (Object.keys(updates).length === 0) {
      return team;
    }

    const [updated] = await this.db
      .update(teams)
      .set(updates)
      .where(eq(teams.id, teamId))
      .returning();

    // Info-only rename announcement to every accepted member +
    // owner, minus the caller. Fires only when the name actually
    // changed (typing `name` into the patch with the same value
    // shouldn't ping the team). Best-effort — alert failures must
    // not abort the team update.
    if (
      data.name !== undefined &&
      data.name !== team.name &&
      data.name.trim().length > 0
    ) {
      await this.announceTeamRename(
        teamId,
        team.name,
        data.name,
        userId,
      );
    }

    return updated;
  }

  /**
   * Fan out a 'team_renamed' info-only notification to every
   * accepted member + owner of the team, minus the caller who
   * made the change. Best-effort, never throws.
   */
  private async announceTeamRename(
    teamId: string,
    previousName: string,
    nextName: string,
    callerUserId: string,
  ): Promise<void> {
    try {
      const recipients = (
        await this.notifications.getTeamMembers(teamId)
      ).filter((id) => id !== callerUserId);
      if (recipients.length === 0) return;
      const [actor] = await this.db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, callerUserId))
        .limit(1);
      const actorName = actor?.name || actor?.email || 'A team manager';
      await Promise.allSettled(
        recipients.map((userId) =>
          this.notifications.create({
            userId,
            type: 'team_renamed',
            title: `Team "${previousName}" was renamed to "${nextName}"`,
            body: `Renamed by ${actorName}.`,
            data: {
              teamId,
              previousName,
              nextName,
              actorId: callerUserId,
              actorName,
            },
          }),
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to announce team rename for ${teamId}: ${msg}`,
      );
    }
  }

  async deleteTeam(teamId: string, userId: string) {
    const [team] = await this.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId));

    if (!team) throw new NotFoundException('Team not found');
    const deleteCallerRole = await this.getUserTeamRole(teamId, userId);
    if (
      deleteCallerRole !== 'owner' &&
      deleteCallerRole !== 'admin' &&
      deleteCallerRole !== 'manager' &&
      deleteCallerRole !== 'editor'
    ) {
      throw new ForbiddenException(
        'Only team owners, admins, managers, or editors can delete the team',
      );
    }

    // Remove all members first (cascade should handle this, but be explicit)
    await this.db
      .delete(teamMembers)
      .where(eq(teamMembers.teamId, teamId));

    await this.db.delete(teams).where(eq(teams.id, teamId));

    return { success: true };
  }

  async updateBudget(
    teamId: string,
    userId: string,
    budgetUsd: number,
  ): Promise<{ monthlyBudgetCents: number }> {
    if (
      typeof budgetUsd !== 'number' ||
      budgetUsd < 0 ||
      !Number.isFinite(budgetUsd)
    ) {
      throw new BadRequestException(
        'budgetUsd must be a non-negative finite number',
      );
    }

    const [team] = await this.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId));

    if (!team) {
      throw new NotFoundException('Team not found');
    }
    const budgetCallerRole = await this.getUserTeamRole(teamId, userId);
    if (!this.hasOwnerRights(budgetCallerRole)) {
      throw new ForbiddenException(
        'Only the team owner or a team admin can update the budget',
      );
    }

    // Suspend semantic: budgetUsd === 0 means "block this team from
    // spending anything until I raise the budget again". The chat
    // gate (assertManagedBudgetApproved) trips on team.budget=0 at
    // request time. We still patch OpenRouter to a $0.01 floor as
    // defense-in-depth — see users.service.updateBudget for the same
    // pattern and rationale.
    const upstreamLimitUsd = budgetUsd === 0 ? 0.01 : budgetUsd;

    let openrouterKeyId = team.openrouterKeyId;
    if (!openrouterKeyId && budgetUsd > 0) {
      // Self-heal: provision a key when the owner sets a real budget
      // for a team that doesn't have one yet (failed create-time
      // provisioning, or a legacy team).
      try {
        const { key, hash } = await this.provisioningService.createKey(
          `team-${team.id}`,
          budgetUsd,
        );
        const encrypted = this.encryptionService.encrypt(key);
        await this.db
          .update(teams)
          .set({
            openrouterKeyId: hash,
            openrouterKeyEncrypted: encrypted,
          })
          .where(eq(teams.id, teamId));
        openrouterKeyId = hash;
        this.logger.log(
          `Provisioned OpenRouter key for team ${teamId} during budget update.`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to provision OpenRouter key for team ${teamId}: ${msg}`,
        );
        throw new ServiceUnavailableException(
          'Could not provision an AI usage key for this team. Please try again in a moment.',
        );
      }
    } else if (openrouterKeyId) {
      await this.provisioningService.updateKey(
        openrouterKeyId,
        upstreamLimitUsd,
      );
    }
    // else: budget=0 AND no key — nothing to provision, gate handles
    // the block. Owner can raise the budget later to enable.

    const budgetCents = Math.round(budgetUsd * 100);
    const previousBudgetCents = team.monthlyBudgetCents;
    await this.db
      .update(teams)
      .set({ monthlyBudgetCents: budgetCents })
      .where(eq(teams.id, teamId));

    // Proactive threshold check after admin-driven budget change.
    // Mirrors the chat-transport gate's logic but triggers off the
    // ADMIN ACTION instead of a chat call — handles the case where
    // lowering the cap suddenly puts the team past 80% / 100%
    // without anyone making a call. Fire-and-forget; alert failures
    // never abort the budget update.
    if (budgetCents > 0) {
      await this.checkAndAlertTeamBudgetThresholds(
        teamId,
        team.name,
        budgetCents,
      );
    }

    // Info-only "budget changed" announcement for owner + admins
    // (minus the caller — they pressed Save, no need to notify them
    // about their own action). Independent of threshold alerts:
    // every actual value change drops a row so the inbox doubles as
    // a lightweight audit trail. Skipped when the new value equals
    // the old (no-op patch).
    if (previousBudgetCents !== budgetCents) {
      await this.announceTeamBudgetChange(
        teamId,
        team.name,
        previousBudgetCents,
        budgetCents,
        userId,
      );
    }

    return { monthlyBudgetCents: budgetCents };
  }

  /**
   * Fan out a 'budget_changed' info-only notification when the team
   * budget actually moves. Recipients = team owner + admins minus
   * the caller. Best-effort, never throws.
   */
  private async announceTeamBudgetChange(
    teamId: string,
    teamName: string,
    previousCents: number,
    nextCents: number,
    callerUserId: string,
  ): Promise<void> {
    try {
      const recipients = (
        await this.notifications.getTeamBudgetRecipients(teamId)
      ).filter((id) => id !== callerUserId);
      if (recipients.length === 0) return;
      const [actor] = await this.db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, callerUserId))
        .limit(1);
      const actorName = actor?.name || actor?.email || 'An admin';
      const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
      await Promise.allSettled(
        recipients.map((userId) =>
          this.notifications.create({
            userId,
            type: 'budget_changed',
            title: `Team "${teamName}"'s monthly budget was changed`,
            body: `${fmt(previousCents)} → ${fmt(nextCents)}. Set by ${actorName}.`,
            data: {
              scope: 'team',
              teamId,
              teamName,
              previousCents,
              nextCents,
              actorId: callerUserId,
              actorName,
            },
          }),
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to announce team-budget change for ${teamId}: ${msg}`,
      );
    }
  }

  /**
   * After a team-budget patch lands, compute the team's current-month
   * spend and enqueue 80% / 100% notifications if the NEW cap puts
   * the team at or past those thresholds. Idempotent via the
   * thresholdKey carried in `data` — re-running for the same
   * (team, threshold, month) is a no-op.
   *
   * Kept private + best-effort: any failure here logs but never
   * throws, so a flaky notification path can't break the budget
   * update itself.
   */
  private async checkAndAlertTeamBudgetThresholds(
    teamId: string,
    teamName: string,
    budgetCents: number,
  ): Promise<void> {
    try {
      const [agg] = await this.db
        .select({
          total: sql<string>`coalesce(sum(${observabilityEvents.costUsd}), 0)`,
        })
        .from(observabilityEvents)
        .where(
          and(
            eq(observabilityEvents.teamId, teamId),
            eq(observabilityEvents.success, true),
            gte(observabilityEvents.createdAt, sql`date_trunc('month', now())`),
          ),
        );
      const spentUsd = agg ? parseFloat(agg.total) : 0;
      const spentCents = Math.round(spentUsd * 100);
      const eightyPct = Math.floor(budgetCents * 0.8);

      const now = new Date();
      const periodKey = `${now.getUTCFullYear()}-${String(
        now.getUTCMonth() + 1,
      ).padStart(2, '0')}`;

      const recipients = await this.notifications.getTeamBudgetRecipients(
        teamId,
      );
      const fanout = async (
        threshold: 80 | 100,
        title: string,
        body: string,
      ) => {
        await Promise.allSettled(
          recipients.map((userId) =>
            this.notifications.createIfNotExists({
              userId,
              type: 'budget_alert',
              title,
              body,
              data: {
                scope: 'team',
                teamId,
                teamName,
                threshold,
                budgetCents,
                spentCents,
                thresholdKey: `${periodKey}:team:${teamId}:${threshold}`,
              },
            }),
          ),
        );
      };

      if (spentCents >= budgetCents) {
        await fanout(
          100,
          `Team "${teamName}" is over its monthly budget`,
          `Spent ~$${(spentCents / 100).toFixed(2)} of $${(budgetCents / 100).toFixed(2)}. The new cap is already exceeded — chat is blocked until you raise it or next month resets.`,
        );
      } else if (spentCents >= eightyPct) {
        await fanout(
          80,
          `Team "${teamName}" has used 80% of its monthly budget`,
          `Spent ~$${(spentCents / 100).toFixed(2)} of $${(budgetCents / 100).toFixed(2)}.`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to evaluate budget-threshold alerts for team ${teamId}: ${msg}`,
      );
    }
  }

  async findAllForUser(userId: string) {
    // Teams where user is owner
    const ownedTeams = await this.db
      .select()
      .from(teams)
      .where(eq(teams.ownerId, userId));

    // Teams where user is accepted member — keep the role so we can
    // derive canManage per team without another query.
    const memberRows = await this.db
      .select({ teamId: teamMembers.teamId, role: teamMembers.role })
      .from(teamMembers)
      .where(
        and(eq(teamMembers.userId, userId), eq(teamMembers.status, 'accepted')),
      );

    const myRoleByTeam = new Map<string, string>(
      memberRows.map((r) => [r.teamId, r.role]),
    );

    const memberTeamIds = memberRows
      .map((r) => r.teamId)
      .filter((id) => !ownedTeams.some((t) => t.id === id));

    let memberTeams: typeof ownedTeams = [];
    if (memberTeamIds.length > 0) {
      memberTeams = await this.db
        .select()
        .from(teams)
        .where(inArray(teams.id, memberTeamIds));
    }

    const allTeams = [...ownedTeams, ...memberTeams];
    if (allTeams.length === 0) return [];

    const allTeamIds = allTeams.map((t) => t.id);

    // Get member counts per team
    const memberCounts = await this.db
      .select({
        teamId: teamMembers.teamId,
        memberCount: sql<number>`cast(count(${teamMembers.id}) as int)`,
      })
      .from(teamMembers)
      .where(inArray(teamMembers.teamId, allTeamIds))
      .groupBy(teamMembers.teamId);

    const countMap = new Map(
      memberCounts.map((r) => [r.teamId, r.memberCount]),
    );

    // Get first 4 accepted members with user info per team
    const avatarRows = await this.db
      .select({
        teamId: teamMembers.teamId,
        email: teamMembers.email,
        name: users.name,
        picture: users.picture,
      })
      .from(teamMembers)
      .leftJoin(users, eq(teamMembers.userId, users.id))
      .where(
        and(
          inArray(teamMembers.teamId, allTeamIds),
          eq(teamMembers.status, 'accepted'),
        ),
      );

    const membersMap = new Map<
      string,
      { name: string | null; picture: string | null }[]
    >();
    for (const row of avatarRows) {
      const arr = membersMap.get(row.teamId) ?? [];
      if (arr.length < 4) {
        arr.push({
          name: row.name ?? row.email,
          picture: row.picture ?? null,
        });
      }
      membersMap.set(row.teamId, arr);
    }

    // Per-team spent / projected from observability_events — see
    // computeTeamUsageMap for why this replaced the OpenRouter lookup.
    const usageMap = await this.computeTeamUsageMap(allTeams.map((t) => t.id));

    return allTeams.map((t) => {
      const usage = usageMap.get(t.id);
      const isOwner = t.ownerId === userId;
      const myRole = myRoleByTeam.get(t.id);
      return {
        ...t,
        memberCount: countMap.get(t.id) ?? 0,
        members: membersMap.get(t.id) ?? [],
        spentCents: usage?.spentCents ?? 0,
        projectedCents: usage?.projectedCents ?? 0,
        // Matches the backend gate for edit/delete/invite/etc:
        // owner, admin, manager, or editor member. Everyone else
        // sees read-only controls.
        canManage:
          isOwner ||
          myRole === 'admin' ||
          myRole === 'manager' ||
          myRole === 'editor',
      };
    });
  }

  async findOne(teamId: string, userId: string) {
    const [team] = await this.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId));

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    // Verify user has access
    const role = await this.getUserTeamRole(teamId, userId);
    if (!role) {
      throw new ForbiddenException('You are not a member of this team');
    }

    // Get members with user info via left join
    const members = await this.db
      .select({
        id: teamMembers.id,
        email: teamMembers.email,
        role: teamMembers.role,
        status: teamMembers.status,
        createdAt: teamMembers.createdAt,
        userId: teamMembers.userId,
        userName: users.name,
        userPicture: users.picture,
        monthlyCapCents: teamMembers.monthlyCapCents,
      })
      .from(teamMembers)
      .leftJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.teamId, teamId));

    // Per-team spent / projected from observability_events — same
    // shape as findAll, see computeTeamUsageMap for rationale.
    const usageMap = await this.computeTeamUsageMap([team.id]);
    const usage = usageMap.get(team.id);
    return {
      ...team,
      members,
      spentCents: usage?.spentCents ?? 0,
      projectedCents: usage?.projectedCents ?? 0,
    };
  }

  async inviteMember(
    teamId: string,
    email: string,
    role: string,
    userId: string,
    /**
     * Optional per-member monthly cap, in cents, applied at invite
     * time. Same semantics as PATCH /teams/:id/members/:memberId/cap:
     *   - undefined / null → no individual cap (shares team budget)
     *   - 0  → invited as suspended (chat blocked at the gate)
     *   - >0 → enforced cap once they accept
     * On a re-invite to the same email, this overwrites the existing
     * cap so admins can adjust during a resend without going to the
     * Members table afterwards.
     */
    monthlyCapCents?: number | null,
  ) {
    // Normalize email so Foo@X.com and foo@x.com can't create two rows or
    // dodge the post-signup sweep, which matches case-sensitively.
    email = email.trim().toLowerCase();

    // Verify caller is the owner or an advanced member of this team.
    const [team] = await this.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId));

    if (!team) {
      throw new NotFoundException('Team not found');
    }
    const callerRole = await this.getUserTeamRole(teamId, userId);
    if (
      callerRole !== 'owner' &&
      callerRole !== 'admin' &&
      callerRole !== 'manager' &&
      callerRole !== 'editor'
    ) {
      throw new ForbiddenException(
        'Only team owners, admins, managers, or editors can invite users',
      );
    }

    if (
      role !== 'admin' &&
      role !== 'manager' &&
      role !== 'editor' &&
      role !== 'viewer'
    ) {
      throw new BadRequestException(
        'Role must be admin, manager, editor, or viewer',
      );
    }
    // Promoting an invitee straight to 'admin' / 'manager' is an
    // owner-level action — editors can invite editors / viewers but
    // can't seed someone with their own privilege ceiling.
    if (
      (role === 'admin' || role === 'manager') &&
      !this.hasOwnerRights(callerRole)
    ) {
      throw new ForbiddenException(
        'Only the team owner, admin, or manager can invite someone as admin or manager',
      );
    }

    if (
      monthlyCapCents !== undefined &&
      monthlyCapCents !== null &&
      (typeof monthlyCapCents !== 'number' ||
        !Number.isInteger(monthlyCapCents) ||
        monthlyCapCents < 0)
    ) {
      throw new BadRequestException(
        'monthlyCapCents must be null or a non-negative integer (cents).',
      );
    }
    // null is the explicit "no cap" sentinel from the invite form;
    // undefined means the caller didn't touch the field. Coalesce so
    // both land as `null` in the row (shares team budget).
    const capValue = monthlyCapCents ?? null;

    // Look up inviter name
    const [inviter] = await this.db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId));
    const inviterName = inviter?.name ?? 'A team member';

    // Does the invited email already belong to a registered account?
    // Used to pick the right email template for both fresh invites and
    // resends.
    const [existingUser] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));

    // Existing row for this email + team?
    const [existing] = await this.db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.email, email)));

    if (existing) {
      // Already accepted — block duplicate invite
      if (existing.status === 'accepted') {
        throw new ConflictException(
          'This user is already a member of the team',
        );
      }

      // Resend path: pending/expired/revoked → re-arm token, reset
      // expiry, resend email. Overwrite the cap when the caller
      // explicitly passed one (so admins can adjust during a resend);
      // leave it untouched on undefined.
      const token = existing.invitationToken ?? randomBytes(32).toString('hex');
      const updates: Record<string, unknown> = {
        role,
        status: 'pending',
        invitationToken: token,
        invitationStatus: 'pending',
        invitationExpiresAt: inviteExpiry(),
        invitationRevokedAt: null,
      };
      if (monthlyCapCents !== undefined) {
        updates.monthlyCapCents = capValue;
      }
      const [refreshed] = await this.db
        .update(teamMembers)
        .set(updates)
        .where(eq(teamMembers.id, existing.id))
        .returning();

      try {
        if (existingUser) {
          await this.mailService.sendTeamInvitationExisting({
            to: email,
            teamName: team.name,
            inviterName,
            role,
            token,
          });
        } else {
          await this.mailService.sendTeamInvitation({
            to: email,
            teamName: team.name,
            inviterName,
            role,
            token,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to resend invitation email: ${msg}`);
      }

      // In-app companion to the email, only for invitees who already
      // have an account (new users can't see the inbox until they
      // sign up — they get the email link instead).
      if (existingUser) {
        await this.notifications.create({
          userId: existingUser.id,
          type: 'team_invite',
          title: `You're invited to ${team.name}`,
          body: `${inviterName} invited you as ${role}.`,
          data: {
            teamId,
            teamName: team.name,
            inviterName,
            role,
            invitationToken: token,
            memberId: refreshed.id,
          },
        });
      }

      return { ...refreshed, resent: true };
    }

    const token = randomBytes(32).toString('hex');

    // Pre-create the org user row so company-profile fields inherit
    // from the team owner — symmetric with /users/invite, just driven
    // by the team-invite entrypoint. Without this, the invitee
    // registers into a blank user row and lands on /setup-profile
    // with the profile-type picker instead of being auto-joined to
    // the workspace.
    //
    // Skipped when an existing row already covers this email — we
    // don't want to overwrite somebody's existing company / personal
    // profile just because they got pulled into a team.
    let inviteeUserId = existingUser?.id ?? null;
    if (!existingUser) {
      const [owner] = await this.db
        .select({
          profileType: users.profileType,
          companyName: users.companyName,
          industry: users.industry,
          teamSize: users.teamSize,
          infraChoice: users.infraChoice,
        })
        .from(users)
        .where(eq(users.id, team.ownerId));

      const inheritsCompany =
        owner?.profileType === 'company' && !!owner.companyName?.trim();
      // onboardingCompletedAt stamped on inherit so /setup-profile's
      // guard bounces the invitee straight to the dashboard with the
      // "Joining …" loader — they don't need to walk the wizard
      // again, the workspace identity is already known.
      const inheritedFields = inheritsCompany
        ? {
            profileType: 'company' as const,
            companyName: owner.companyName,
            industry: owner.industry,
            teamSize: owner.teamSize,
            infraChoice: owner.infraChoice,
            onboardingCompletedAt: new Date(),
          }
        : {};

      const [created] = await this.db
        .insert(users)
        .values({
          email,
          role: 'basic',
          inviteStatus: 'pending',
          ...inheritedFields,
        })
        .returning({ id: users.id });
      inviteeUserId = created.id;
    }

    const [member] = await this.db
      .insert(teamMembers)
      .values({
        teamId,
        userId: inviteeUserId,
        email,
        role,
        status: 'pending',
        invitationToken: token,
        invitationStatus: 'pending',
        invitationExpiresAt: inviteExpiry(),
        monthlyCapCents: capValue,
      })
      .returning();

    try {
      if (existingUser) {
        await this.mailService.sendTeamInvitationExisting({
          to: email,
          teamName: team.name,
          inviterName,
          role,
          token,
        });
      } else {
        await this.mailService.sendTeamInvitation({
          to: email,
          teamName: team.name,
          inviterName,
          role,
          token,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send invitation email: ${msg}`);
    }

    // Mirror the email with an in-app notification, but only for
    // invitees who already have an account — new-user invitees
    // can't see the bell yet, they get the email link only.
    if (existingUser) {
      await this.notifications.create({
        userId: existingUser.id,
        type: 'team_invite',
        title: `You're invited to ${team.name}`,
        body: `${inviterName} invited you as ${role}.`,
        data: {
          teamId,
          teamName: team.name,
          inviterName,
          role,
          invitationToken: token,
          memberId: member.id,
        },
      });
    }

    return { ...member, resent: false };
  }

  async listInvitations(teamId: string, userId: string) {
    const [team] = await this.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId));
    if (!team) throw new NotFoundException('Team not found');
    const listCallerRole = await this.getUserTeamRole(teamId, userId);
    if (!this.hasOwnerRights(listCallerRole)) {
      throw new ForbiddenException(
        'Only the team owner or a team admin can list invitations',
      );
    }

    const rows = await this.db
      .select({
        id: teamMembers.id,
        email: teamMembers.email,
        role: teamMembers.role,
        invitationStatus: teamMembers.invitationStatus,
        invitationExpiresAt: teamMembers.invitationExpiresAt,
        invitationRevokedAt: teamMembers.invitationRevokedAt,
        createdAt: teamMembers.createdAt,
      })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.status, 'pending'),
        ),
      );

    // Surface lazy expiry to the caller without writing to the row here.
    const now = Date.now();
    return rows.map((r) => ({
      ...r,
      invitationStatus:
        r.invitationStatus === 'pending' &&
        r.invitationExpiresAt &&
        r.invitationExpiresAt.getTime() < now
          ? 'expired'
          : r.invitationStatus ?? 'pending',
    }));
  }

  async revokeInvitation(memberId: string, userId: string) {
    const [row] = await this.db
      .select({
        id: teamMembers.id,
        teamId: teamMembers.teamId,
        status: teamMembers.status,
        ownerId: teams.ownerId,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.id, memberId));

    if (!row) throw new NotFoundException('Invitation not found');
    const revokeCallerRole = await this.getUserTeamRole(row.teamId, userId);
    if (!this.hasOwnerRights(revokeCallerRole)) {
      throw new ForbiddenException(
        'Only the team owner or a team admin can revoke invitations',
      );
    }
    if (row.status === 'accepted') {
      throw new BadRequestException(
        'Cannot revoke an invitation that has already been accepted',
      );
    }

    const [updated] = await this.db
      .update(teamMembers)
      .set({
        invitationStatus: 'revoked',
        invitationRevokedAt: new Date(),
        invitationToken: null,
      })
      .where(eq(teamMembers.id, memberId))
      .returning();

    return updated;
  }

  async updateMemberRole(
    teamId: string,
    memberId: string,
    role: string,
    userId: string,
  ) {
    const [team] = await this.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId));

    if (!team) {
      throw new NotFoundException('Team not found');
    }
    // Owners, admins, managers, and editors can update roles;
    // viewers / non-members can't. Promoting someone to / from
    // 'admin' or 'manager' is owner-level only, enforced below.
    const callerRole = await this.getUserTeamRole(teamId, userId);
    if (
      callerRole !== 'owner' &&
      callerRole !== 'admin' &&
      callerRole !== 'manager' &&
      callerRole !== 'editor'
    ) {
      throw new ForbiddenException(
        'Only team owners, admins, managers, or editors can update member roles',
      );
    }

    if (
      role !== 'admin' &&
      role !== 'manager' &&
      role !== 'editor' &&
      role !== 'viewer'
    ) {
      throw new BadRequestException(
        'Role must be admin, manager, editor, or viewer',
      );
    }
    if (
      (role === 'admin' || role === 'manager') &&
      !this.hasOwnerRights(callerRole)
    ) {
      throw new ForbiddenException(
        'Only the team owner, admin, or manager can promote someone to admin or manager',
      );
    }

    // Always look up the target so we can apply the owner-row guard
    // below — and so the demote-admin/manager gate has the role to
    // inspect. Cheap: one indexed PK probe.
    const [target] = await this.db
      .select({ userId: teamMembers.userId, role: teamMembers.role })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.id, memberId),
          eq(teamMembers.teamId, teamId),
        ),
      );

    // Owner row is pinned to `team.ownerId`; demoting it would leave
    // a team with a member row whose role contradicts `teams.owner_id`.
    // Mirror the removeMember guard so any caller, owner included,
    // has to transfer ownership before fiddling with this row.
    if (target?.userId && target.userId === team.ownerId) {
      throw new BadRequestException(
        'Cannot change the team owner\'s role. Transfer ownership first.',
      );
    }

    // Symmetric guard: demoting an existing admin / manager is also
    // owner-level — keeps editors from kicking admins/managers down
    // a tier.
    if (
      (target?.role === 'admin' || target?.role === 'manager') &&
      !this.hasOwnerRights(callerRole)
    ) {
      throw new ForbiddenException(
        'Only the team owner, admin, or manager can change another admin or manager\'s role',
      );
    }

    const [updated] = await this.db
      .update(teamMembers)
      .set({ role })
      .where(and(eq(teamMembers.id, memberId), eq(teamMembers.teamId, teamId)))
      .returning();

    if (!updated) {
      throw new NotFoundException('Member not found');
    }

    return updated;
  }

  async removeMember(teamId: string, memberId: string, userId: string) {
    const [team] = await this.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId));

    if (!team) {
      throw new NotFoundException('Team not found');
    }
    const removeCallerRole = await this.getUserTeamRole(teamId, userId);
    if (
      removeCallerRole !== 'owner' &&
      removeCallerRole !== 'admin' &&
      removeCallerRole !== 'manager' &&
      removeCallerRole !== 'editor'
    ) {
      throw new ForbiddenException(
        'Only team owners, admins, managers, or editors can remove members',
      );
    }

    // Prevent removing self (owner)
    const [member] = await this.db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.id, memberId), eq(teamMembers.teamId, teamId)));

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    // Mirror of the demote-admin/manager guard in updateMemberRole:
    // an editor can't kick an admin or manager out, since both are
    // owner-equivalent.
    if (
      (member.role === 'admin' || member.role === 'manager') &&
      !this.hasOwnerRights(removeCallerRole)
    ) {
      throw new ForbiddenException(
        'Only the team owner, admin, or manager can remove another admin or manager',
      );
    }

    if (member.userId === userId) {
      throw new BadRequestException('Cannot remove yourself from the team');
    }

    // The team owner is pinned to the member list (teams.owner_id is a
    // NOT NULL FK) — editors mustn't be able to evict them.
    if (member.userId && member.userId === team.ownerId) {
      throw new BadRequestException(
        'Cannot remove the team owner. Transfer ownership first.',
      );
    }

    await this.db
      .delete(teamMembers)
      .where(and(eq(teamMembers.id, memberId), eq(teamMembers.teamId, teamId)));

    return { success: true };
  }

  async getUserTeamRole(
    teamId: string,
    userId: string,
  ): Promise<'owner' | 'admin' | 'manager' | 'editor' | 'viewer' | null> {
    const [team] = await this.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId));

    if (!team) return null;
    if (team.ownerId === userId) return 'owner';

    const [member] = await this.db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, userId),
          eq(teamMembers.status, 'accepted'),
        ),
      );

    if (!member) return null;
    // `admin` and `manager` are both owner-equivalent member roles —
    // `manager` was added so admins can delegate operational tasks
    // without conflating with the higher "admin" connotation in copy.
    // Legacy `advanced` / `basic` map for back-compat with older
    // rows that haven't been migrated.
    const roleMap: Record<
      string,
      'owner' | 'admin' | 'manager' | 'editor' | 'viewer'
    > = {
      owner: 'owner',
      admin: 'admin',
      manager: 'manager',
      advanced: 'editor',
      editor: 'editor',
      basic: 'viewer',
      viewer: 'viewer',
    };
    return roleMap[member.role] ?? 'viewer';
  }

  /**
   * Owner-level rights: real team owner OR member with role='admin'
   * or role='manager' (both treated as owner-equivalent per product
   * decision — manager is a label distinction, not a rights one).
   * Used for paths previously gated by `team.ownerId !== userId` —
   * budget, invitations, role promotions. None of these roles can
   * be the literal team owner row; that one is pinned to
   * `teams.owner_id` and must be transferred to change.
   */
  private hasOwnerRights(
    role: 'owner' | 'admin' | 'manager' | 'editor' | 'viewer' | null,
  ): boolean {
    return role === 'owner' || role === 'admin' || role === 'manager';
  }

  async getUserTeamIds(userId: string): Promise<string[]> {
    // Teams where user is owner
    const ownedTeams = await this.db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.ownerId, userId));

    // Teams where user is accepted member
    const memberTeams = await this.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(
        and(eq(teamMembers.userId, userId), eq(teamMembers.status, 'accepted')),
      );

    const ids = new Set([
      ...ownedTeams.map((t) => t.id),
      ...memberTeams.map((t) => t.teamId),
    ]);

    return [...ids];
  }



  async getInviteByToken(token: string) {
    const [member] = await this.db
      .select({
        id: teamMembers.id,
        email: teamMembers.email,
        role: teamMembers.role,
        status: teamMembers.status,
        invitationStatus: teamMembers.invitationStatus,
        invitationExpiresAt: teamMembers.invitationExpiresAt,
        invitationRevokedAt: teamMembers.invitationRevokedAt,
        teamName: teams.name,
        inviterName: users.name,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .innerJoin(users, eq(teams.ownerId, users.id))
      .where(eq(teamMembers.invitationToken, token));

    if (!member) {
      throw new NotFoundException('Invitation not found');
    }

    if (member.status === 'accepted') {
      throw new BadRequestException('Invitation has already been accepted');
    }

    if (member.invitationStatus === 'revoked' || member.invitationRevokedAt) {
      throw new BadRequestException('Invitation has been revoked');
    }

    if (
      member.invitationExpiresAt &&
      member.invitationExpiresAt.getTime() < Date.now()
    ) {
      // Lazy mark as expired so future reads are consistent
      await this.db
        .update(teamMembers)
        .set({ invitationStatus: 'expired' })
        .where(eq(teamMembers.id, member.id));
      throw new BadRequestException('Invitation has expired');
    }

    // Does this email already map to a USABLE account? The /invite
    // page uses this to route logged-out users to /login instead of
    // the set-password signup.
    //
    // Subtle: we now pre-create a `users` row at team-invite time
    // (to inherit the inviter's company fields). That row has no
    // passwordHash and no googleId until the invitee actually
    // registers. If `hasAccount` checked row existence alone, the FE
    // would route the invitee to /login — and they'd be stuck,
    // because there's no password to log in with. So check for an
    // actual sign-in credential, not just a row.
    const [existingUser] = await this.db
      .select({
        passwordHash: users.passwordHash,
        googleId: users.googleId,
      })
      .from(users)
      .where(eq(users.email, member.email.toLowerCase()));

    const hasAccount =
      !!existingUser &&
      (!!existingUser.passwordHash || !!existingUser.googleId);

    return {
      email: member.email,
      role: member.role,
      teamName: member.teamName,
      inviterName: member.inviterName,
      expiresAt: member.invitationExpiresAt?.toISOString() ?? null,
      hasAccount,
    };
  }

  async acceptInviteByToken(token: string, userId: string, userEmail: string) {
    const [member] = await this.db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.invitationToken, token));

    if (!member) {
      throw new NotFoundException('Invitation not found');
    }

    if (member.status === 'accepted') {
      throw new BadRequestException('Invitation has already been accepted');
    }

    if (member.invitationStatus === 'revoked' || member.invitationRevokedAt) {
      throw new BadRequestException('Invitation has been revoked');
    }

    if (
      member.invitationExpiresAt &&
      member.invitationExpiresAt.getTime() < Date.now()
    ) {
      await this.db
        .update(teamMembers)
        .set({ invitationStatus: 'expired' })
        .where(eq(teamMembers.id, member.id));
      throw new BadRequestException('Invitation has expired');
    }

    if (member.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ForbiddenException(
        'This invitation was sent to a different email address',
      );
    }

    const [updated] = await this.db
      .update(teamMembers)
      .set({
        userId,
        status: 'accepted',
        invitationToken: null,
        invitationStatus: 'accepted',
      })
      .where(eq(teamMembers.id, member.id))
      .returning();

    return updated;
  }

  async findSubteams(parentTeamId: string) {
    const subteams = await this.db
      .select()
      .from(teams)
      .where(eq(teams.parentTeamId, parentTeamId));

    if (subteams.length === 0) return [];

    const subteamIds = subteams.map((t) => t.id);

    // Member counts
    const memberCounts = await this.db
      .select({
        teamId: teamMembers.teamId,
        memberCount: sql<number>`cast(count(${teamMembers.id}) as int)`,
      })
      .from(teamMembers)
      .where(inArray(teamMembers.teamId, subteamIds))
      .groupBy(teamMembers.teamId);

    const countMap = new Map(
      memberCounts.map((r) => [r.teamId, r.memberCount]),
    );

    // Member avatars (first 4 accepted per subteam)
    const avatarRows = await this.db
      .select({
        teamId: teamMembers.teamId,
        email: teamMembers.email,
        name: users.name,
        picture: users.picture,
      })
      .from(teamMembers)
      .leftJoin(users, eq(teamMembers.userId, users.id))
      .where(
        and(
          inArray(teamMembers.teamId, subteamIds),
          eq(teamMembers.status, 'accepted'),
        ),
      );

    const membersMap = new Map<
      string,
      { name: string | null; picture: string | null }[]
    >();
    for (const row of avatarRows) {
      const arr = membersMap.get(row.teamId) ?? [];
      if (arr.length < 4) {
        arr.push({ name: row.name ?? row.email, picture: row.picture ?? null });
      }
      membersMap.set(row.teamId, arr);
    }

    // Per-subteam spent / projected from observability_events — same
    // shape as findAll, see computeTeamUsageMap for rationale.
    const usageMap = await this.computeTeamUsageMap(subteams.map((t) => t.id));

    return subteams.map((t) => {
      const usage = usageMap.get(t.id);
      return {
        ...t,
        memberCount: countMap.get(t.id) ?? 0,
        members: membersMap.get(t.id) ?? [],
        spentCents: usage?.spentCents ?? 0,
        projectedCents: usage?.projectedCents ?? 0,
      };
    });
  }

  /**
   * Rules visible on this team's detail page. Two sources:
   *
   *  1. Rules explicitly linked via `guardrail_teams` — each gets
   *     `teamIsActive` from the link row (per-team pause toggle).
   *  2. Org-wide rules whose owner shares this team's company —
   *     surfaced with `teamIsActive=true` (org-wide can't be paused
   *     per-team) and `isOrgWide=true` so the FE can disable the
   *     per-team Switch + "Remove from team" affordances.
   *
   * "Same company" resolved by joining users on `company_name`.
   * Teams without a resolvable company (orphan teams from before the
   * profile flow) silently skip the org-wide branch.
   */
  async findGuardrails(teamId: string) {
    const linked = await this.db
      .select({
        id: guardrails.id,
        ownerId: guardrails.ownerId,
        name: guardrails.name,
        type: guardrails.type,
        severity: guardrails.severity,
        triggers: guardrails.triggers,
        isActive: guardrails.isActive,
        isOrgWide: guardrails.isOrgWide,
        teamIsActive: guardrailTeams.isActive,
        validatorType: guardrails.validatorType,
        entities: guardrails.entities,
        pattern: guardrails.pattern,
        target: guardrails.target,
        onFail: guardrails.onFail,
        templateSource: guardrails.templateSource,
        createdAt: guardrails.createdAt,
        updatedAt: guardrails.updatedAt,
      })
      .from(guardrails)
      .innerJoin(
        guardrailTeams,
        eq(guardrailTeams.guardrailId, guardrails.id),
      )
      .where(eq(guardrailTeams.teamId, teamId));

    // Resolve the team's company via its owner. The team rows have
    // owner_id → users; users.company_name is the org boundary.
    const [teamRow] = await this.db
      .select({ ownerId: teams.ownerId })
      .from(teams)
      .where(eq(teams.id, teamId));
    if (!teamRow) return linked;
    const [teamOwner] = await this.db
      .select({ companyName: users.companyName })
      .from(users)
      .where(eq(users.id, teamRow.ownerId));
    if (!teamOwner?.companyName) return linked;

    const orgWide = await this.db
      .select({
        id: guardrails.id,
        ownerId: guardrails.ownerId,
        name: guardrails.name,
        type: guardrails.type,
        severity: guardrails.severity,
        triggers: guardrails.triggers,
        isActive: guardrails.isActive,
        isOrgWide: guardrails.isOrgWide,
        teamIsActive: sql<boolean>`true`,
        validatorType: guardrails.validatorType,
        entities: guardrails.entities,
        pattern: guardrails.pattern,
        target: guardrails.target,
        onFail: guardrails.onFail,
        templateSource: guardrails.templateSource,
        createdAt: guardrails.createdAt,
        updatedAt: guardrails.updatedAt,
      })
      .from(guardrails)
      .innerJoin(users, eq(users.id, guardrails.ownerId))
      .where(
        and(
          eq(guardrails.isOrgWide, true),
          eq(users.companyName, teamOwner.companyName),
        ),
      );

    // Dedup: an org-wide rule that ALSO has an explicit link to this
    // team shows up in both lists. Keep the org-wide row (it
    // suppresses the per-team toggle on the FE).
    const linkedIds = new Set(linked.map((r) => r.id));
    const orgOnly = orgWide.filter((r) => !linkedIds.has(r.id));
    return [
      ...linked.map((r) => ({
        ...r,
        // Hide team UI affordances for rows that are also org-wide
        // (e.g. admin first linked, then toggled org-wide). Same
        // resulting shape as the orgOnly branch.
        teamIsActive: r.isOrgWide ? true : r.teamIsActive,
      })),
      ...orgOnly,
    ];
  }

  /**
   * Team-scoped integrations. Mirrors the personal Integration tab
   * but the configured key is shared across every team member: when
   * one of them chats with a model from this provider, chat-transport
   * routes through this team key first, before falling back to their
   * personal BYOK or the WorkenAI default.
   *
   * Returns both:
   *   - Predefined providers (Anthropic, OpenAI, …) — at most one row
   *     per (team, provider). Untouched providers appear with id=null.
   *   - Team-scoped Custom LLM rows — each is its own card; the bound
   *     model_configs alias is auto-created at upsert time so members
   *     see the endpoint in their picker without admin touching
   *     /catalog separately.
   */
  async listIntegrations(
    teamId: string,
    userId: string,
  ): Promise<IntegrationView[]> {
    const role = await this.getUserTeamRole(teamId, userId);
    if (!role) {
      throw new ForbiddenException('You are not a member of this team');
    }

    const rows = await this.db
      .select()
      .from(integrations)
      .where(eq(integrations.teamId, teamId));

    // Aggregate observability scoped to this team. Same shape as
    // IntegrationsService.listForUser but the filter is teamId rather
    // than userId, so cards reflect what the *whole team* spent
    // through that provider — not whoever last opened the page.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const statsRows = await this.db
      .select({
        provider: observabilityEvents.provider,
        successCount: sql<number>`count(*) filter (where ${observabilityEvents.success}=true)::int`,
        totalCount: sql<number>`count(*)::int`,
        thisMonth: sql<number>`count(*) filter (where ${observabilityEvents.createdAt} >= date_trunc('month', now()))::int`,
      })
      .from(observabilityEvents)
      .where(
        and(
          eq(observabilityEvents.teamId, teamId),
          gte(observabilityEvents.createdAt, since),
        ),
      )
      .groupBy(observabilityEvents.provider);

    const peakRows = await this.db.execute<{
      provider: string;
      peak: number;
    }>(sql`
      SELECT provider, MAX(daily_count)::int AS peak
      FROM (
        SELECT
          ${observabilityEvents.provider} AS provider,
          DATE_TRUNC('day', ${observabilityEvents.createdAt}) AS day,
          COUNT(*) AS daily_count
        FROM ${observabilityEvents}
        WHERE
          ${observabilityEvents.teamId} = ${teamId}
          AND ${observabilityEvents.createdAt} >= ${since}
          AND ${observabilityEvents.provider} IS NOT NULL
        GROUP BY provider, day
      ) AS daily
      GROUP BY provider
    `);

    const statsByProvider = new Map<
      string,
      {
        successCount: number;
        totalCount: number;
        thisMonth: number;
        peakDaily: number;
      }
    >();
    for (const r of statsRows) {
      if (!r.provider) continue;
      statsByProvider.set(r.provider, {
        successCount: Number(r.successCount ?? 0),
        totalCount: Number(r.totalCount ?? 0),
        thisMonth: Number(r.thisMonth ?? 0),
        peakDaily: 0,
      });
    }
    const peakRowList =
      (peakRows as { rows?: unknown[] }).rows ?? peakRows;
    if (Array.isArray(peakRowList)) {
      for (const r of peakRowList as {
        provider: string;
        peak: number;
      }[]) {
        if (!r.provider) continue;
        const existing = statsByProvider.get(r.provider) ?? {
          successCount: 0,
          totalCount: 0,
          thisMonth: 0,
          peakDaily: 0,
        };
        existing.peakDaily = Number(r.peak ?? 0);
        statsByProvider.set(r.provider, existing);
      }
    }

    const buildStats = (providerId: string) => {
      const s = statsByProvider.get(providerId);
      const successRate =
        s && s.totalCount > 0 ? s.successCount / s.totalCount : 0;
      return {
        successRate,
        apiCalls: s?.thisMonth ?? 0,
        peakDailyCalls: s?.peakDaily ?? 0,
      };
    };

    const out: IntegrationView[] = PREDEFINED_PROVIDERS.map((p) => {
      const row = rows.find(
        (r) => r.providerId === p.id && r.apiUrl === null,
      );
      return {
        id: row?.id ?? null,
        providerId: p.id,
        displayName: p.displayName,
        description: p.description,
        iconHint: p.iconHint,
        apiUrl: null,
        hasApiKey: !!row?.apiKeyEncrypted,
        isEnabled: row?.isEnabled ?? false,
        isCustom: false,
        openAICompatible: p.openAICompatible,
        byokSupported: p.byokSupported,
        boundAliasCount: 0,
        stats: buildStats(p.id),
        createdAt: row?.createdAt?.toISOString() ?? null,
        updatedAt: row?.updatedAt?.toISOString() ?? null,
      };
    });

    // Custom LLM rows after predefined, sorted by createdAt asc so
    // the FE order is stable. Each custom row is its own card —
    // (teamId, providerId='custom') intentionally not unique.
    const customs = rows
      .filter((r) => r.providerId === 'custom' && r.apiUrl !== null)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() -
          new Date(b.createdAt).getTime(),
      );
    if (customs.length > 0) {
      // For each custom row, surface the bound alias's customName so
      // admin sees "Local Llama" rather than just the URL hostname.
      const customIds = customs.map((c) => c.id);
      const aliasRows = await this.db
        .select({
          integrationId: modelConfigs.integrationId,
          customName: modelConfigs.customName,
        })
        .from(modelConfigs)
        .where(
          and(
            eq(modelConfigs.teamId, teamId),
            inArray(modelConfigs.integrationId, customIds),
          ),
        );
      const aliasNameByIntegration = new Map<string, string>();
      for (const a of aliasRows) {
        if (a.integrationId) {
          aliasNameByIntegration.set(a.integrationId, a.customName);
        }
      }
      for (const r of customs) {
        const aliasName = aliasNameByIntegration.get(r.id);
        out.push({
          id: r.id,
          providerId: 'custom',
          displayName: aliasName ?? deriveCustomDisplayName(r.apiUrl ?? ''),
          description: r.apiUrl ?? '',
          iconHint: 'custom',
          apiUrl: r.apiUrl,
          hasApiKey: !!r.apiKeyEncrypted,
          isEnabled: r.isEnabled,
          isCustom: true,
          openAICompatible: true,
          byokSupported: true,
          boundAliasCount: aliasName ? 1 : 0,
          stats: buildStats('custom'),
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        });
      }
    }
    return out;
  }

  async upsertIntegration(
    teamId: string,
    callerId: string,
    input: {
      providerId: string;
      apiUrl?: string | null;
      apiKey?: string | null;
      isEnabled?: boolean;
      // Required for providerId='custom'. Used as the alias's display
      // name AND model identifier — members will pick this in the
      // model dropdown and chat-transport routes the call through the
      // bound integration.
      customName?: string | null;
    },
  ): Promise<IntegrationView> {
    const role = await this.getUserTeamRole(teamId, callerId);
    if (
      role !== 'owner' &&
      role !== 'admin' &&
      role !== 'manager' &&
      role !== 'editor'
    ) {
      throw new ForbiddenException(
        'Only team owners, admins, managers, or editors can manage team integrations',
      );
    }
    const isCustom = input.providerId === 'custom';
    if (!isCustom && !isPredefinedProvider(input.providerId)) {
      throw new BadRequestException(
        `Unknown provider: ${input.providerId}`,
      );
    }

    const apiKeyEncrypted = input.apiKey?.trim()
      ? this.encryptionService.encrypt(input.apiKey.trim())
      : null;

    // Custom LLMs at team scope: every Add creates a new (integration,
    // alias) pair — admin can register many endpoints (Ollama, vLLM,
    // Together, …) per team. The alias is what members see in their
    // model dropdown; chat-transport's team-scoped lookup routes
    // through the bound integration.
    if (isCustom) {
      if (!input.apiUrl?.trim()) {
        throw new BadRequestException('Custom LLM requires apiUrl');
      }
      try {
        new URL(input.apiUrl);
      } catch {
        throw new BadRequestException('apiUrl is not a valid URL');
      }
      const customName = input.customName?.trim();
      if (!customName) {
        throw new BadRequestException(
          'Custom LLM requires a name members will see in the model picker',
        );
      }
      const modelIdentifier = teamCustomModelIdentifier(teamId, customName);

      // Reject collisions on (teamId, modelIdentifier) up-front rather
      // than letting the DB explode at insert time — gives a clean
      // error message instead of a 500.
      const [existing] = await this.db
        .select({ id: modelConfigs.id })
        .from(modelConfigs)
        .where(
          and(
            eq(modelConfigs.teamId, teamId),
            eq(modelConfigs.modelIdentifier, modelIdentifier),
          ),
        )
        .limit(1);
      if (existing) {
        throw new BadRequestException(
          `A Custom LLM named "${customName}" already exists for this team. Pick a different name.`,
        );
      }

      const [integration] = await this.db
        .insert(integrations)
        .values({
          ownerId: callerId,
          teamId,
          providerId: 'custom',
          apiUrl: input.apiUrl,
          apiKeyEncrypted,
          isEnabled: input.isEnabled ?? true,
        })
        .returning();
      // Auto-create the alias so members can immediately pick the
      // Custom LLM from their model dropdown without admin needing to
      // touch /catalog separately.
      await this.db.insert(modelConfigs).values({
        ownerId: callerId,
        teamId,
        customName,
        modelIdentifier,
        integrationId: integration.id,
        isActive: true,
      });

      const all = await this.listIntegrations(teamId, callerId);
      const view = all.find((v) => v.id === integration.id);
      if (!view) {
        throw new NotFoundException('Custom integration not found after insert');
      }
      return view;
    }

    // Predefined providers: upsert against the team-scoped partial
    // unique index — at most one row per (team, providerId).
    const conflictUpdates: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (input.isEnabled !== undefined) {
      conflictUpdates.isEnabled = input.isEnabled;
    }
    if (input.apiKey !== undefined) {
      conflictUpdates.apiKeyEncrypted = apiKeyEncrypted;
    }

    await this.db
      .insert(integrations)
      .values({
        ownerId: callerId,
        teamId,
        providerId: input.providerId,
        apiUrl: null,
        apiKeyEncrypted,
        isEnabled: input.isEnabled ?? true,
      })
      .onConflictDoUpdate({
        target: [integrations.teamId, integrations.providerId],
        targetWhere: sql`${integrations.apiUrl} IS NULL AND ${integrations.teamId} IS NOT NULL`,
        set: conflictUpdates,
      });

    const all = await this.listIntegrations(teamId, callerId);
    const view = all.find((v) => v.providerId === input.providerId);
    if (!view) {
      throw new NotFoundException('Integration not found after upsert');
    }
    return view;
  }

  async updateIntegration(
    teamId: string,
    callerId: string,
    integrationId: string,
    input: {
      isEnabled?: boolean;
      apiKey?: string | null;
      /** Custom rows only — new endpoint URL. Validated as URL. */
      apiUrl?: string;
      /** Custom rows only — display name in the model picker. The
       *  underlying modelIdentifier stays stable so ongoing chats
       *  bound to the alias don't break. */
      customName?: string;
    },
  ): Promise<IntegrationView> {
    const role = await this.getUserTeamRole(teamId, callerId);
    if (
      role !== 'owner' &&
      role !== 'admin' &&
      role !== 'manager' &&
      role !== 'editor'
    ) {
      throw new ForbiddenException(
        'Only team owners, admins, managers, or editors can manage team integrations',
      );
    }
    const [row] = await this.db
      .select()
      .from(integrations)
      .where(eq(integrations.id, integrationId));
    if (!row) throw new NotFoundException('Integration not found');
    if (row.teamId !== teamId) {
      throw new BadRequestException(
        'Integration does not belong to this team',
      );
    }

    // Custom-only fields (apiUrl, customName) are nonsense on
    // predefined rows — reject up-front so admins don't accidentally
    // think they renamed Anthropic.
    const isCustom = row.providerId === 'custom';
    if (!isCustom && (input.apiUrl !== undefined || input.customName !== undefined)) {
      throw new BadRequestException(
        'apiUrl and customName can only be set on Custom LLM integrations.',
      );
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.isEnabled !== undefined) updates.isEnabled = input.isEnabled;
    if (input.apiKey !== undefined) {
      updates.apiKeyEncrypted = input.apiKey
        ? this.encryptionService.encrypt(input.apiKey)
        : null;
    }
    if (input.apiUrl !== undefined) {
      const trimmed = input.apiUrl.trim();
      if (!trimmed) {
        throw new BadRequestException('apiUrl cannot be empty.');
      }
      try {
        new URL(trimmed);
      } catch {
        throw new BadRequestException('apiUrl is not a valid URL.');
      }
      updates.apiUrl = trimmed;
    }
    await this.db
      .update(integrations)
      .set(updates)
      .where(eq(integrations.id, integrationId));

    // Custom name lives on the bound alias (model_configs.custom_name),
    // not on the integration row. Update it there. modelIdentifier
    // stays untouched on purpose: it's the stable handle members'
    // chats / conversations are bound to.
    if (isCustom && input.customName !== undefined) {
      const trimmedName = input.customName.trim();
      if (!trimmedName) {
        throw new BadRequestException('customName cannot be empty.');
      }
      await this.db
        .update(modelConfigs)
        .set({ customName: trimmedName, updatedAt: new Date() })
        .where(
          and(
            eq(modelConfigs.teamId, teamId),
            eq(modelConfigs.integrationId, integrationId),
          ),
        );
    }

    const all = await this.listIntegrations(teamId, callerId);
    const view = isCustom
      ? all.find((v) => v.id === integrationId)
      : all.find((v) => v.providerId === row.providerId);
    if (!view) {
      throw new NotFoundException('Integration not found after update');
    }
    return view;
  }

  async removeIntegration(
    teamId: string,
    callerId: string,
    integrationId: string,
  ): Promise<{ success: true }> {
    const role = await this.getUserTeamRole(teamId, callerId);
    if (
      role !== 'owner' &&
      role !== 'admin' &&
      role !== 'manager' &&
      role !== 'editor'
    ) {
      throw new ForbiddenException(
        'Only team owners, admins, managers, or editors can manage team integrations',
      );
    }
    const [row] = await this.db
      .select()
      .from(integrations)
      .where(eq(integrations.id, integrationId));
    if (!row) throw new NotFoundException('Integration not found');
    if (row.teamId !== teamId) {
      throw new BadRequestException(
        'Integration does not belong to this team',
      );
    }
    // Custom team integrations have a paired team-scoped alias in
    // model_configs that's auto-created at upsert time. The FK is
    // ON DELETE SET NULL — without explicit cleanup the alias would
    // survive as an orphan with integrationId=null AND a
    // `team:xxx:slug` modelIdentifier that no provider can serve,
    // showing up in members' pickers as a dead entry. Drop it.
    if (row.providerId === 'custom') {
      await this.db
        .delete(modelConfigs)
        .where(
          and(
            eq(modelConfigs.teamId, teamId),
            eq(modelConfigs.integrationId, integrationId),
          ),
        );
    }
    await this.db
      .delete(integrations)
      .where(eq(integrations.id, integrationId));
    return { success: true };
  }

  /**
   * Set the per-member monthly spend cap inside this team. The cap
   * gates this user's chat calls against the team's spend, regardless
   * of whether routing lands on the team OpenRouter key or a team-
   * scoped BYOK key. Cap semantics:
   *   - null → no individual cap (member shares the team budget)
   *   - 0    → suspended (chat blocked at the gate)
   *   - >0   → enforced against current-month observability spend
   */
  async updateMemberCap(
    teamId: string,
    memberId: string,
    monthlyCapCents: number | null,
    callerId: string,
  ) {
    const role = await this.getUserTeamRole(teamId, callerId);
    if (
      role !== 'owner' &&
      role !== 'admin' &&
      role !== 'manager' &&
      role !== 'editor'
    ) {
      throw new ForbiddenException(
        'Only team owners, admins, managers, or editors can set member caps',
      );
    }
    if (
      monthlyCapCents !== null &&
      (typeof monthlyCapCents !== 'number' ||
        !Number.isInteger(monthlyCapCents) ||
        monthlyCapCents < 0)
    ) {
      throw new BadRequestException(
        'monthlyCapCents must be null or a non-negative integer (cents).',
      );
    }
    const [updated] = await this.db
      .update(teamMembers)
      .set({ monthlyCapCents })
      .where(
        and(
          eq(teamMembers.id, memberId),
          eq(teamMembers.teamId, teamId),
        ),
      )
      .returning({
        id: teamMembers.id,
        monthlyCapCents: teamMembers.monthlyCapCents,
      });
    if (!updated) {
      throw new NotFoundException('Member not found');
    }
    return updated;
  }

  /**
   * Per-team spent + projected for the current calendar month, sourced
   * from `observability_events`. Replaces the older
   * `provisioningService.getKeyUsage()` lookup so the numbers shown on
   * the Teams listing + detail pages match what the chat-time gate
   * actually enforces (which also reads observability and therefore
   * counts BYOK + Custom routes that bypass OpenRouter's sub-account
   * limit). Catalog-priced cost is approximate vs OpenRouter's "actual
   * billed" number — the trade-off is consistency with enforcement,
   * which matters more than dollar-perfect display.
   *
   * Custom routes log cost=null and contribute $0 to the sum, same as
   * in the chat gate. Projection is the existing linear extrapolation
   * (current spend × daysInMonth / dayOfMonth).
   */
  private async computeTeamUsageMap(
    teamIds: string[],
  ): Promise<Map<string, { spentCents: number; projectedCents: number }>> {
    const usage = new Map<
      string,
      { spentCents: number; projectedCents: number }
    >();
    if (teamIds.length === 0) return usage;

    const startOfMonth = sql`date_trunc('month', now())`;
    const rows = await this.db
      .select({
        teamId: observabilityEvents.teamId,
        total: sql<string>`coalesce(sum(${observabilityEvents.costUsd}), 0)`,
      })
      .from(observabilityEvents)
      .where(
        and(
          inArray(observabilityEvents.teamId, teamIds),
          eq(observabilityEvents.success, true),
          gte(observabilityEvents.createdAt, startOfMonth),
        ),
      )
      .groupBy(observabilityEvents.teamId);

    const now = new Date();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getDate();

    for (const row of rows) {
      if (!row.teamId) continue; // teamId is nullable on the table — skip teamless events
      const spentUsd = parseFloat(row.total);
      const spentCents = Math.round(spentUsd * 100);
      const projectedCents =
        dayOfMonth > 0
          ? Math.round((spentCents / dayOfMonth) * daysInMonth)
          : spentCents;
      usage.set(row.teamId, { spentCents, projectedCents });
    }
    return usage;
  }
}

/**
 * Build a stable, namespaced model identifier for a team-scoped Custom
 * LLM alias. Members see `customName` in the picker; this is what the
 * chat layer uses internally to look the alias up. Format keeps it
 * collision-free across teams without exposing a raw UUID.
 */
function teamCustomModelIdentifier(teamId: string, customName: string): string {
  const slug = customName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  // First 8 chars of the team uuid is enough to disambiguate — names
  // are scoped to (teamId, modelIdentifier) anyway via the upsert
  // collision check.
  const teamShort = teamId.slice(0, 8);
  return `team:${teamShort}:${slug || 'custom'}`;
}

/** Same fallback the personal Integration tab uses for naming. */
function deriveCustomDisplayName(url: string): string {
  try {
    return new URL(url).hostname || 'Custom LLM';
  } catch {
    return 'Custom LLM';
  }
}
