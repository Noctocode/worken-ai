import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import {
  users,
  teamMembers,
  teams,
  projects,
  conversations,
  guardrails,
  tenders,
  tenderTeamMembers,
  knowledgeFolders,
  knowledgeFiles,
  modelConfigs,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { OpenRouterProvisioningService } from '../openrouter/openrouter-provisioning.service.js';

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly provisioningService: OpenRouterProvisioningService,
  ) {}

  async findAll() {
    const allUsers = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        picture: users.picture,
        role: users.role,
        inviteStatus: users.inviteStatus,
        monthlyBudgetCents: users.monthlyBudgetCents,
        createdAt: users.createdAt,
      })
      .from(users);

    // Get team memberships for all users
    const memberships = await this.db
      .select({
        userId: teamMembers.userId,
        teamName: teams.name,
        role: teamMembers.role,
        status: teamMembers.status,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id));

    const userTeams = new Map<
      string,
      { teams: string[]; highestRole: string; status: string }
    >();
    for (const m of memberships) {
      if (!m.userId) continue;
      const entry = userTeams.get(m.userId) ?? {
        teams: [],
        highestRole: 'basic',
        status: 'pending',
      };
      entry.teams.push(m.teamName);
      // Promote role: admin > advanced > basic
      if (
        m.role === 'advanced' &&
        entry.highestRole === 'basic'
      ) {
        entry.highestRole = 'advanced';
      }
      if (m.status === 'accepted') {
        entry.status = 'accepted';
      }
      userTeams.set(m.userId, entry);
    }

    // Check which users are team owners (they get "admin" role)
    const ownedTeams = await this.db
      .select({ ownerId: teams.ownerId })
      .from(teams);
    const ownerIds = new Set(ownedTeams.map((t) => t.ownerId));

    return allUsers.map((u) => {
      const membership = userTeams.get(u.id);

      return {
        id: u.id,
        name: u.name,
        email: u.email,
        picture: u.picture,
        role: u.role,
        inviteStatus: u.inviteStatus,
        status: membership?.status ?? 'accepted',
        teams: membership?.teams ?? [],
        monthlyBudgetCents: u.monthlyBudgetCents,
        spentCents: 0, // TODO: integrate with OpenRouter usage API
        projectedCents: 0, // TODO: integrate with OpenRouter usage API
        createdAt: u.createdAt,
      };
    });
  }

  async findOne(userId: string, callerId: string) {
    const [user] = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        picture: users.picture,
        monthlyBudgetCents: users.monthlyBudgetCents,
        openrouterKeyId: users.openrouterKeyId,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get team memberships with team info
    const membershipRows = await this.db
      .select({
        memberId: teamMembers.id,
        teamId: teams.id,
        teamName: teams.name,
        role: teamMembers.role,
        status: teamMembers.status,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(eq(teamMembers.userId, userId));

    // Determine org-level role
    const isOwner = await this.db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.ownerId, userId))
      .limit(1);

    let role: string = 'basic';
    if (isOwner.length > 0) {
      role = 'admin';
    } else if (membershipRows.some((m) => m.role === 'advanced')) {
      role = 'advanced';
    }

    // Fetch usage data from user's OpenRouter key
    let spentCents = 0;
    let projectedCents = 0;
    if (user.openrouterKeyId) {
      const usage = await this.provisioningService.getKeyUsage(
        user.openrouterKeyId,
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

    // Advanced if owner of any team OR advanced member in any team.
    const isAdvanced =
      isOwner.length > 0 ||
      membershipRows.some((m) => m.role === 'advanced');

    // Derive — from the CALLER's perspective — which of these teams they
    // can manage (owner OR accepted advanced member). Drives the per-team
    // role select and actions on the user detail page.
    const teamIds = membershipRows.map((m) => m.teamId);
    const callerOwnedTeams =
      teamIds.length === 0
        ? []
        : await this.db
            .select({ id: teams.id })
            .from(teams)
            .where(
              and(inArray(teams.id, teamIds), eq(teams.ownerId, callerId)),
            );
    const callerMemberships =
      teamIds.length === 0
        ? []
        : await this.db
            .select({
              teamId: teamMembers.teamId,
              role: teamMembers.role,
            })
            .from(teamMembers)
            .where(
              and(
                inArray(teamMembers.teamId, teamIds),
                eq(teamMembers.userId, callerId),
                eq(teamMembers.status, 'accepted'),
              ),
            );
    const callerOwnedIds = new Set(callerOwnedTeams.map((t) => t.id));
    const callerRoleByTeam = new Map(
      callerMemberships.map((m) => [m.teamId, m.role]),
    );

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      picture: user.picture,
      role,
      tier: (isAdvanced ? 'advanced' : 'basic') as 'advanced' | 'basic',
      monthlyBudgetCents: user.monthlyBudgetCents,
      spentCents,
      projectedCents,
      teams: membershipRows.map((m) => ({
        id: m.teamId,
        memberId: m.memberId,
        name: m.teamName,
        role: m.role,
        status: m.status,
        canManage:
          callerOwnedIds.has(m.teamId) ||
          callerRoleByTeam.get(m.teamId) === 'advanced',
      })),
      createdAt: user.createdAt,
    };
  }

  async updateBudget(
    userId: string,
    budgetUsd: number,
  ): Promise<{ monthlyBudgetCents: number }> {
    if (typeof budgetUsd !== 'number' || budgetUsd <= 0) {
      throw new BadRequestException('budgetUsd must be a positive number');
    }

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Update OpenRouter key limit if provisioned
    if (user.openrouterKeyId) {
      await this.provisioningService.updateKey(user.openrouterKeyId, budgetUsd);
    }

    const budgetCents = Math.round(budgetUsd * 100);
    await this.db
      .update(users)
      .set({ monthlyBudgetCents: budgetCents })
      .where(eq(users.id, userId));

    return { monthlyBudgetCents: budgetCents };
  }

  async remove(userId: string, callerId: string) {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (userId === callerId) {
      throw new BadRequestException('You cannot remove yourself');
    }

    // Team owners can't be deleted because teams.owner_id is NOT NULL FK.
    // Fail early with a clear message instead of letting the DB throw.
    const ownedTeams = await this.db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.ownerId, userId));
    if (ownedTeams.length > 0) {
      throw new BadRequestException(
        `Cannot remove this user — they own ${ownedTeams.length} team${
          ownedTeams.length === 1 ? '' : 's'
        } (${ownedTeams.map((t) => t.name).join(', ')}). Transfer ownership first.`,
      );
    }

    // Remove all user data before deleting (order matters for FK constraints)
    await this.db.delete(teamMembers).where(eq(teamMembers.userId, userId));
    await this.db.delete(tenderTeamMembers).where(eq(tenderTeamMembers.userId, userId));
    await this.db.delete(tenders).where(eq(tenders.ownerId, userId));
    await this.db.delete(knowledgeFolders).where(eq(knowledgeFolders.ownerId, userId));
    await this.db.delete(modelConfigs).where(eq(modelConfigs.ownerId, userId));
    await this.db.delete(conversations).where(eq(conversations.userId, userId));
    await this.db.delete(projects).where(eq(projects.userId, userId));

    // Nullify nullable FK references
    await this.db
      .update(knowledgeFiles)
      .set({ uploadedById: null })
      .where(eq(knowledgeFiles.uploadedById, userId));

    // Handle guardrails.owner_id (exists in DB from other branch merge)
    try {
      await this.db.execute(
        `DELETE FROM guardrails WHERE owner_id = '${userId}'`,
      );
    } catch {
      // Column may not exist on this branch
    }

    // Delete user
    await this.db.delete(users).where(eq(users.id, userId));

    return { success: true };
  }
}
