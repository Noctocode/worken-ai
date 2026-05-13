import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  users,
  teamMembers,
  teams,
  projects,
  conversations,
  guardrails,
  messages,
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

  async findAll(callerId: string) {
    // Scope: a single-tenant deployment is one company AND can also
    // host independent Private Pro accounts side-by-side. A company-
    // profile caller sees only other company-profile users (plus
    // NULL-profile rows, which are pending invitees mid-flow that
    // haven't completed onboarding yet — admin needs them in the
    // list to see who's still queued). Personal-profile (Private
    // Pro) callers see only themselves; their account is isolated.
    const [caller] = await this.db
      .select({ profileType: users.profileType })
      .from(users)
      .where(eq(users.id, callerId));
    const isCompanyScope = caller?.profileType === 'company';

    const baseSelect = {
      id: users.id,
      name: users.name,
      email: users.email,
      picture: users.picture,
      role: users.role,
      inviteStatus: users.inviteStatus,
      monthlyBudgetCents: users.monthlyBudgetCents,
      infraChoice: users.infraChoice,
      createdAt: users.createdAt,
    };
    const allUsers = isCompanyScope
      ? await this.db
          .select(baseSelect)
          .from(users)
          // 'personal' rows are independent Private Pro accounts —
          // they share the deployment but not the company tenancy.
          // Filter them out so a company admin's user list doesn't
          // surface unrelated personal accounts.
          .where(
            or(
              eq(users.profileType, 'company'),
              isNull(users.profileType),
            ),
          )
      : await this.db
          .select(baseSelect)
          .from(users)
          .where(eq(users.id, callerId));

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
        // Managed-Cloud users sit in this state from the moment they
        // finish onboarding until an admin explicitly sets a budget
        // in Management → Users (which provisions or patches their
        // OpenRouter key). Drives the "N users awaiting budget
        // approval" banner. Predicate is keyed on `infraChoice` rather
        // than `openrouterKeyId` so users whose onboarding-time
        // provisioning failed still surface — they need admin action
        // just as much as the success path.
        pendingBudgetApproval:
          u.infraChoice === 'managed' && u.monthlyBudgetCents === 0,
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
          callerRoleByTeam.get(m.teamId) === 'admin' ||
          callerRoleByTeam.get(m.teamId) === 'manager' ||
          callerRoleByTeam.get(m.teamId) === 'editor',
      })),
      createdAt: user.createdAt,
    };
  }

  async updateBudget(
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

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Suspend semantic: budgetUsd === 0 means "block this user from
    // spending anything until I raise the budget again".
    // assertManagedBudgetApproved already trips on budget=0+managed at
    // request time, so the suspend is enforced at our layer. We still
    // patch the OpenRouter cap to a $0.01 floor (not 0 — OpenRouter
    // treats `limit: null` as unenforced and the `0` case is
    // undocumented) as defense-in-depth: if our gate is ever
    // bypassed, the upstream cap stops runaway spend at 1 cent.
    const upstreamLimitUsd = budgetUsd === 0 ? 0.01 : budgetUsd;

    if (user.openrouterKeyId) {
      await this.provisioningService.updateKey(
        user.openrouterKeyId,
        upstreamLimitUsd,
      );
    } else if (budgetUsd > 0) {
      // Self-heal: provision a key when the admin sets a real budget
      // for a user that doesn't have one yet (failed onboarding-time
      // provisioning, or a managed-cloud user under the new design
      // where onboarding deliberately skips provisioning).
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
          `Provisioned OpenRouter key for user ${userId} during budget update.`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to provision OpenRouter key for user ${userId}: ${msg}`,
        );
        throw new ServiceUnavailableException(
          'Could not provision an AI usage key for this user. Please try again in a moment.',
        );
      }
    }
    // else: budget=0 AND no key — nothing to provision, our gate
    // handles the block. Admin can raise the budget later to enable.

    const budgetCents = Math.round(budgetUsd * 100);
    await this.db
      .update(users)
      .set({ monthlyBudgetCents: budgetCents })
      .where(eq(users.id, userId));

    return { monthlyBudgetCents: budgetCents };
  }

  /**
   * Promote / demote a user's organization-level role. Caller-side
   * checks (admin guard, self-mutation block) live in the controller;
   * here we just validate the value and write.
   */
  async updateRole(
    userId: string,
    role: string,
  ): Promise<{ id: string; role: string }> {
    const validRoles = ['basic', 'advanced', 'admin'];
    if (!validRoles.includes(role)) {
      throw new BadRequestException(
        `Role must be one of: ${validRoles.join(', ')}`,
      );
    }

    const [updated] = await this.db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ id: users.id, role: users.role });

    if (!updated) throw new NotFoundException('User not found');
    return updated;
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
        // guardrail_teams links cascade-delete with their team row,
        // so no explicit cleanup is needed here. The rule definitions
        // themselves stay — they're owned by users, not teams, and
        // get cleaned up further below as part of the user delete.
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
      // Personal/global guardrails owned by the user (team_id NULL) AND
      // any straggler guardrails the user owns on someone else's team —
      // both have a NO ACTION FK to users.id, so without this they'd
      // block the final users delete with a 23503 violation.
      await tx.delete(guardrails).where(eq(guardrails.ownerId, userId));
      await tx.delete(conversations).where(eq(conversations.userId, userId));
      await tx.delete(projects).where(eq(projects.userId, userId));

      await tx
        .update(knowledgeFiles)
        .set({ uploadedById: null })
        .where(eq(knowledgeFiles.uploadedById, userId));

      // Messages the user posted in conversations owned by SOMEONE ELSE
      // (e.g., team chats) survive the conversations delete above. The
      // FK is NO ACTION, so we null out the author to preserve the
      // thread for the remaining members rather than block the delete.
      await tx
        .update(messages)
        .set({ userId: null })
        .where(eq(messages.userId, userId));

      await tx.delete(users).where(eq(users.id, userId));
    });

    return { success: true };
  }
}
