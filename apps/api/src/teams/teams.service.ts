import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';

const INVITE_EXPIRY_DAYS = 7;
const inviteExpiry = () =>
  new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
import { teams, teamMembers, users, guardrails } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { MailService } from '../mail/mail.service.js';
import { EncryptionService } from '../openrouter/encryption.service.js';
import { OpenRouterProvisioningService } from '../openrouter/openrouter-provisioning.service.js';

@Injectable()
export class TeamsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly mailService: MailService,
    private readonly provisioningService: OpenRouterProvisioningService,
    private readonly encryptionService: EncryptionService,
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
      if (parentRole !== 'owner' && parentRole !== 'editor') {
        throw new ForbiddenException(
          'Only team owners or editors can add subteams',
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

    // Auto-add owner as accepted editor member
    await this.db.insert(teamMembers).values({
      teamId: team.id,
      userId,
      email,
      role: 'editor',
      status: 'accepted',
    });

    // Provision OpenRouter key for this team (non-blocking)
    const budgetUsd = budgetCents / 100;
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
        .where(eq(teams.id, team.id));
    } catch (err) {
      console.error('Failed to provision team OpenRouter key:', err);
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
    if (updateCallerRole !== 'owner' && updateCallerRole !== 'editor') {
      throw new ForbiddenException(
        'Only team owners or editors can update the team',
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

    return updated;
  }

  async deleteTeam(teamId: string, userId: string) {
    const [team] = await this.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId));

    if (!team) throw new NotFoundException('Team not found');
    const deleteCallerRole = await this.getUserTeamRole(teamId, userId);
    if (deleteCallerRole !== 'owner' && deleteCallerRole !== 'editor') {
      throw new ForbiddenException(
        'Only team owners or editors can delete the team',
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
    if (typeof budgetUsd !== 'number' || budgetUsd <= 0) {
      throw new BadRequestException('budgetUsd must be a positive number');
    }

    const [team] = await this.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId));

    if (!team) {
      throw new NotFoundException('Team not found');
    }
    if (team.ownerId !== userId) {
      throw new ForbiddenException('Only the team owner can update the budget');
    }
    if (!team.openrouterKeyId) {
      throw new BadRequestException(
        'This team does not have a provisioned OpenRouter key',
      );
    }

    await this.provisioningService.updateKey(team.openrouterKeyId, budgetUsd);

    const budgetCents = Math.round(budgetUsd * 100);
    await this.db
      .update(teams)
      .set({ monthlyBudgetCents: budgetCents })
      .where(eq(teams.id, teamId));

    return { monthlyBudgetCents: budgetCents };
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

    // Fetch usage data for each team's OpenRouter key
    const usageMap = new Map<
      string,
      { spentCents: number; projectedCents: number }
    >();
    for (const t of allTeams) {
      if (t.openrouterKeyId) {
        const usage = await this.provisioningService.getKeyUsage(
          t.openrouterKeyId,
        );
        if (usage) {
          const dayOfMonth = new Date().getDate();
          const daysInMonth = new Date(
            new Date().getFullYear(),
            new Date().getMonth() + 1,
            0,
          ).getDate();
          const projectedCents =
            dayOfMonth > 0
              ? Math.round((usage.usageCents / dayOfMonth) * daysInMonth)
              : usage.usageCents;
          usageMap.set(t.id, {
            spentCents: usage.usageCents,
            projectedCents,
          });
        }
      }
    }

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
        // Matches the backend gate for edit/delete/invite/etc: owner or
        // advanced member. Everyone else sees read-only controls.
        canManage: isOwner || myRole === 'editor',
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
      })
      .from(teamMembers)
      .leftJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.teamId, teamId));

    // Fetch usage data from OpenRouter key
    let spentCents = 0;
    let projectedCents = 0;
    if (team.openrouterKeyId) {
      const usage = await this.provisioningService.getKeyUsage(
        team.openrouterKeyId,
      );
      if (usage) {
        spentCents = usage.usageCents;
        const dayOfMonth = new Date().getDate();
        const daysInMonth = new Date(
          new Date().getFullYear(),
          new Date().getMonth() + 1,
          0,
        ).getDate();
        projectedCents =
          dayOfMonth > 0
            ? Math.round((usage.usageCents / dayOfMonth) * daysInMonth)
            : usage.usageCents;
      }
    }

    return { ...team, members, spentCents, projectedCents };
  }

  async inviteMember(
    teamId: string,
    email: string,
    role: string,
    userId: string,
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
    if (callerRole !== 'owner' && callerRole !== 'editor') {
      throw new ForbiddenException(
        'Only team owners or editors can invite users',
      );
    }

    if (role !== 'editor' && role !== 'viewer') {
      throw new BadRequestException('Role must be editor or viewer');
    }

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

      // Resend path: pending/expired/revoked → re-arm token, reset expiry, resend email
      const token = existing.invitationToken ?? randomBytes(32).toString('hex');
      const [refreshed] = await this.db
        .update(teamMembers)
        .set({
          role,
          status: 'pending',
          invitationToken: token,
          invitationStatus: 'pending',
          invitationExpiresAt: inviteExpiry(),
          invitationRevokedAt: null,
        })
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
        console.error('Failed to resend invitation email:', err);
      }

      return { ...refreshed, resent: true };
    }

    const token = randomBytes(32).toString('hex');

    const [member] = await this.db
      .insert(teamMembers)
      .values({
        teamId,
        userId: existingUser?.id ?? null,
        email,
        role,
        status: 'pending',
        invitationToken: token,
        invitationStatus: 'pending',
        invitationExpiresAt: inviteExpiry(),
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
      console.error('Failed to send invitation email:', err);
    }

    return { ...member, resent: false };
  }

  async listInvitations(teamId: string, userId: string) {
    const [team] = await this.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId));
    if (!team) throw new NotFoundException('Team not found');
    if (team.ownerId !== userId) {
      throw new ForbiddenException('Only the team owner can list invitations');
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
    if (row.ownerId !== userId) {
      throw new ForbiddenException('Only the team owner can revoke invitations');
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
    // Owners and editors can update roles; viewers/non-members can't.
    const callerRole = await this.getUserTeamRole(teamId, userId);
    if (callerRole !== 'owner' && callerRole !== 'editor') {
      throw new ForbiddenException(
        'Only team owners or editors can update member roles',
      );
    }

    if (role !== 'editor' && role !== 'viewer') {
      throw new BadRequestException('Role must be editor or viewer');
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
    if (removeCallerRole !== 'owner' && removeCallerRole !== 'editor') {
      throw new ForbiddenException(
        'Only team owners or editors can remove members',
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
  ): Promise<'owner' | 'editor' | 'viewer' | null> {
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
    return member.role as 'editor' | 'viewer';
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

    // Does this email already map to a registered account? The /invite
    // page uses this to route logged-out users to /login instead of the
    // set-password signup.
    const [existingUser] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, member.email.toLowerCase()));

    return {
      email: member.email,
      role: member.role,
      teamName: member.teamName,
      inviterName: member.inviterName,
      expiresAt: member.invitationExpiresAt?.toISOString() ?? null,
      hasAccount: !!existingUser,
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

    // Usage data per subteam
    const usageMap = new Map<
      string,
      { spentCents: number; projectedCents: number }
    >();
    for (const t of subteams) {
      if (t.openrouterKeyId) {
        const usage = await this.provisioningService.getKeyUsage(
          t.openrouterKeyId,
        );
        if (usage) {
          const dayOfMonth = new Date().getDate();
          const daysInMonth = new Date(
            new Date().getFullYear(),
            new Date().getMonth() + 1,
            0,
          ).getDate();
          usageMap.set(t.id, {
            spentCents: usage.usageCents,
            projectedCents:
              dayOfMonth > 0
                ? Math.round((usage.usageCents / dayOfMonth) * daysInMonth)
                : usage.usageCents,
          });
        }
      }
    }

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

  async findGuardrails(teamId: string) {
    return this.db
      .select()
      .from(guardrails)
      .where(eq(guardrails.teamId, teamId));
  }

  async createGuardrail(
    teamId: string,
    userId: string,
    data: { name: string; type: string; severity: string },
  ) {
    const [team] = await this.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId));

    if (!team) throw new NotFoundException('Team not found');
    {
      const callerRole = await this.getUserTeamRole(teamId, userId);
      if (callerRole !== 'owner' && callerRole !== 'editor') {
        throw new ForbiddenException(
          'Only team owners or editors can add guardrails',
        );
      }
    }

    if (!['high', 'medium', 'low'].includes(data.severity)) {
      throw new BadRequestException('Severity must be high, medium, or low');
    }

    const [created] = await this.db
      .insert(guardrails)
      .values({
        teamId,
        name: data.name,
        type: data.type,
        severity: data.severity,
      })
      .returning();

    return created;
  }

  async toggleGuardrail(
    teamId: string,
    guardrailId: string,
    userId: string,
    isActive: boolean,
  ) {
    const [team] = await this.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId));

    if (!team) throw new NotFoundException('Team not found');
    {
      const callerRole = await this.getUserTeamRole(teamId, userId);
      if (callerRole !== 'owner' && callerRole !== 'editor') {
        throw new ForbiddenException(
          'Only team owners or editors can update guardrails',
        );
      }
    }

    const [updated] = await this.db
      .update(guardrails)
      .set({ isActive })
      .where(
        and(eq(guardrails.id, guardrailId), eq(guardrails.teamId, teamId)),
      )
      .returning();

    if (!updated) throw new NotFoundException('Guardrail not found');
    return updated;
  }

  async deleteGuardrail(
    teamId: string,
    guardrailId: string,
    userId: string,
  ) {
    const [team] = await this.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId));

    if (!team) throw new NotFoundException('Team not found');
    {
      const callerRole = await this.getUserTeamRole(teamId, userId);
      if (callerRole !== 'owner' && callerRole !== 'editor') {
        throw new ForbiddenException(
          'Only team owners or editors can delete guardrails',
        );
      }
    }

    await this.db
      .delete(guardrails)
      .where(
        and(eq(guardrails.id, guardrailId), eq(guardrails.teamId, teamId)),
      );

    return { success: true };
  }
}
