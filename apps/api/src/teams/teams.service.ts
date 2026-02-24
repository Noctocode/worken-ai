import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { teams, teamMembers, users } from '@worken/database/schema';
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

  async create(name: string, userId: string, email: string) {
    const [team] = await this.db
      .insert(teams)
      .values({ name, ownerId: userId })
      .returning();

    // Auto-add owner as accepted advanced member
    await this.db.insert(teamMembers).values({
      teamId: team.id,
      userId,
      email,
      role: 'advanced',
      status: 'accepted',
    });

    // Provision OpenRouter key for this team (non-blocking)
    try {
      const { key, hash } = await this.provisioningService.createKey(
        `team-${team.id}`,
        10, // price limit of 10$ hardcoded for now
      );
      const encrypted = this.encryptionService.encrypt(key);
      await this.db
        .update(teams)
        .set({
          openrouterKeyId: hash,
          openrouterKeyEncrypted: encrypted,
          monthlyBudgetCents: 1000,
        })
        .where(eq(teams.id, team.id));
    } catch (err) {
      console.error('Failed to provision team OpenRouter key:', err);
    }

    return team;
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

    // Teams where user is accepted member
    const memberRows = await this.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(
        and(eq(teamMembers.userId, userId), eq(teamMembers.status, 'accepted')),
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

    return [...ownedTeams, ...memberTeams];
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

    return { ...team, members };
  }

  async inviteMember(
    teamId: string,
    email: string,
    role: string,
    userId: string,
  ) {
    // Verify caller is owner
    const [team] = await this.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId));

    if (!team) {
      throw new NotFoundException('Team not found');
    }
    if (team.ownerId !== userId) {
      throw new ForbiddenException('Only the team owner can invite members');
    }

    if (role !== 'basic' && role !== 'advanced') {
      throw new BadRequestException('Role must be basic or advanced');
    }

    // Check for duplicate
    const [existing] = await this.db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.email, email)));

    if (existing) {
      throw new ConflictException(
        'This email has already been invited to this team',
      );
    }

    // Look up inviter name
    const [inviter] = await this.db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId));

    const token = randomBytes(32).toString('hex');

    const [member] = await this.db
      .insert(teamMembers)
      .values({
        teamId,
        email,
        role,
        status: 'pending',
        invitationToken: token,
      })
      .returning();

    await this.mailService.sendTeamInvitation({
      to: email,
      teamName: team.name,
      inviterName: inviter?.name ?? 'A team member',
      role,
      token,
    });

    return member;
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
    if (team.ownerId !== userId) {
      throw new ForbiddenException(
        'Only the team owner can update member roles',
      );
    }

    if (role !== 'basic' && role !== 'advanced') {
      throw new BadRequestException('Role must be basic or advanced');
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
    if (team.ownerId !== userId) {
      throw new ForbiddenException('Only the team owner can remove members');
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

    await this.db
      .delete(teamMembers)
      .where(and(eq(teamMembers.id, memberId), eq(teamMembers.teamId, teamId)));

    return { success: true };
  }

  async getUserTeamRole(
    teamId: string,
    userId: string,
  ): Promise<'owner' | 'basic' | 'advanced' | null> {
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
    return member.role as 'basic' | 'advanced';
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

  async userHasAdvancedRoleInAnyTeam(userId: string): Promise<boolean> {
    // Check if owner of any team
    const [owned] = await this.db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.ownerId, userId))
      .limit(1);

    if (owned) return true;

    // Check if advanced member in any team
    const [advanced] = await this.db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.userId, userId),
          eq(teamMembers.role, 'advanced'),
          eq(teamMembers.status, 'accepted'),
        ),
      )
      .limit(1);

    return !!advanced;
  }

  async getInviteByToken(token: string) {
    const [member] = await this.db
      .select({
        email: teamMembers.email,
        role: teamMembers.role,
        status: teamMembers.status,
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

    return {
      email: member.email,
      role: member.role,
      teamName: member.teamName,
      inviterName: member.inviterName,
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

    if (member.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ForbiddenException(
        'This invitation was sent to a different email address',
      );
    }

    const [updated] = await this.db
      .update(teamMembers)
      .set({ userId, status: 'accepted', invitationToken: null })
      .where(eq(teamMembers.id, member.id))
      .returning();

    return updated;
  }
}
