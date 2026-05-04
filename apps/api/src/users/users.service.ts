import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
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
import { EncryptionService } from '../openrouter/encryption.service.js';
import { OpenRouterProvisioningService } from '../openrouter/openrouter-provisioning.service.js';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly provisioningService: OpenRouterProvisioningService,
    private readonly encryptionService: EncryptionService,
  ) {}

  /**
   * Lightweight lookup used by the API-key auth guard to populate
   * `AuthenticatedUser`. Returns null instead of throwing because the
   * guard turns "not found" into 401, not 404.
   */
  async findById(
    userId: string,
  ): Promise<{ id: string; email: string } | null> {
    const [row] = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  }

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
        role: users.role,
        inviteStatus: users.inviteStatus,
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

    // Derive — from the CALLER's perspective — which of these teams they
    // can manage (owner OR accepted editor). Drives the per-team
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
      role: user.role,
      inviteStatus: user.inviteStatus,
      tier: (user.role === 'admin' || user.role === 'advanced' ? 'advanced' : 'basic') as 'advanced' | 'basic',
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
          callerRoleByTeam.get(m.teamId) === 'editor',
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

    // Self-heal: if the user has no OpenRouter key (provisioning failed at
    // signup, or this is a legacy user), provision one now using the
    // budget the admin just submitted. Without this the budget would be
    // stored only in our DB while OpenRouter has no enforcement at all.
    if (user.openrouterKeyId) {
      await this.provisioningService.updateKey(user.openrouterKeyId, budgetUsd);
    } else {
      try {
        const { key, hash } = await this.provisioningService.createKey(
          `user-${userId}`,
          budgetUsd,
        );
        const encrypted = this.encryptionService.encrypt(key);
        await this.db
          .update(users)
          .set({
            openrouterKeyId: hash,
            openrouterKeyEncrypted: encrypted,
          })
          .where(eq(users.id, userId));
        this.logger.log(
          `Reprovisioned OpenRouter key for user ${userId} during budget update.`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to reprovision OpenRouter key for user ${userId}: ${msg}`,
        );
        throw new ServiceUnavailableException(
          'Could not provision an OpenRouter key for this user. Please try again in a moment.',
        );
      }
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

    await this.db.transaction(async (tx) => {
      const ownedTeams = await tx
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.ownerId, userId));
      const ownedTeamIds = ownedTeams.map((t) => t.id);

      if (ownedTeamIds.length > 0) {
        await tx.delete(guardrails).where(inArray(guardrails.teamId, ownedTeamIds));
        await tx
          .update(projects)
          .set({ teamId: null })
          .where(inArray(projects.teamId, ownedTeamIds));
        await tx.delete(teamMembers).where(inArray(teamMembers.teamId, ownedTeamIds));
        await tx.delete(teams).where(inArray(teams.id, ownedTeamIds));
      }

      await tx.delete(teamMembers).where(eq(teamMembers.userId, userId));
      await tx.delete(tenderTeamMembers).where(eq(tenderTeamMembers.userId, userId));
      await tx.delete(tenders).where(eq(tenders.ownerId, userId));
      await tx.delete(knowledgeFolders).where(eq(knowledgeFolders.ownerId, userId));
      await tx.delete(modelConfigs).where(eq(modelConfigs.ownerId, userId));
      await tx.delete(conversations).where(eq(conversations.userId, userId));
      await tx.delete(projects).where(eq(projects.userId, userId));

      await tx
        .update(knowledgeFiles)
        .set({ uploadedById: null })
        .where(eq(knowledgeFiles.uploadedById, userId));

      await tx.delete(users).where(eq(users.id, userId));
    });

    return { success: true };
  }
}
