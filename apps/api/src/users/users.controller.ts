import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import { TeamsService } from '../teams/teams.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { eq } from 'drizzle-orm';
import { users } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { MailService } from '../mail/mail.service.js';
import { ObservabilityService } from '../observability/observability.service.js';

@Controller('users')
export class UsersController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
    private readonly mailService: MailService,
    private readonly observabilityService: ObservabilityService,
  ) {}

  @Get()
  findAll(@CurrentUser() caller: AuthenticatedUser) {
    return this.usersService.findAll(caller.id);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() caller: AuthenticatedUser,
  ) {
    return this.usersService.findOne(id, caller.id);
  }

  /**
   * User-scoped activity log: paginated observability events for the
   * given user (chat / arena / evaluator calls, with model, cost,
   * latency, success). Reuses ObservabilityService.listEvents under
   * the hood with a from=epoch / to=now window so the result is the
   * full lifetime of the user, not the dashboard's range filter.
   *
   * Auth: admin can see anyone's activity; non-admins can only see
   * their own. Activity contains promptPreview snippets, so we don't
   * leak it across users at non-admin level.
   */
  @Get(':id/activity')
  async activity(
    @Param('id') id: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ) {
    const [callerUser] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, caller.id));
    const isAdmin = callerUser?.role === 'admin';
    if (!isAdmin && caller.id !== id) {
      throw new ForbiddenException(
        'You can only view your own activity log.',
      );
    }
    const page = Math.max(1, Number(pageRaw) || 1);
    const pageSize = Math.max(1, Math.min(Number(pageSizeRaw) || 50, 200));
    return this.observabilityService.listEvents({
      from: new Date(0),
      to: new Date(),
      userId: id,
      page,
      pageSize,
    });
  }

  @Post('invite')
  async inviteUser(
    @Body() body: { email: string; role: string },
    @CurrentUser() caller: AuthenticatedUser,
  ) {
    // Only admin/advanced can invite
    const [callerUser] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, caller.id));
    if (!callerUser || (callerUser.role !== 'admin' && callerUser.role !== 'advanced')) {
      throw new ForbiddenException('Only admin or advanced users can invite users.');
    }

    const validRoles = ['basic', 'advanced'];
    if (!validRoles.includes(body.role)) {
      throw new BadRequestException('Role must be basic or advanced.');
    }

    const email = body.email.trim().toLowerCase();
    if (!email) throw new BadRequestException('Email is required.');

    // Check if user already exists
    const [existing] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email));

    const inviterName = callerUser.name || callerUser.email;

    // Company fields the invitee inherits from the inviter so they
    // can skip the wizard on first login — they're joining an
    // existing workspace, the company identity is already known.
    // Only kicks in when the inviter themselves is a fully-onboarded
    // company-profile admin/advanced; otherwise we leave the new
    // user blank and let onboarding fill those fields normally.
    const inviterCompany = callerUser.companyName?.trim();
    const inheritsCompany =
      callerUser.profileType === 'company' && !!inviterCompany;
    const inheritedFields = inheritsCompany
      ? {
          profileType: 'company' as const,
          companyName: callerUser.companyName,
          industry: callerUser.industry,
          teamSize: callerUser.teamSize,
          infraChoice: callerUser.infraChoice,
          // Marking onboarding complete short-circuits the
          // /setup-profile redirect on first login. The user can
          // still revisit Account → Profile to tweak fields.
          onboardingCompletedAt: new Date(),
        }
      : {};

    if (existing) {
      // Block cross-company invites: if the target already onboarded
      // under a different `companyName`, we can't quietly absorb them
      // into this org without overwriting their workspace identity.
      // Pre-onboarding rows (companyName=null) and matching companies
      // pass through. The admin sees a clean 409 instead of two users
      // ending up with mismatched Company-tab views.
      const existingCompany = existing.companyName?.trim();
      if (
        inviterCompany &&
        existingCompany &&
        inviterCompany !== existingCompany
      ) {
        throw new ConflictException(
          `${email} already belongs to another company (${existingCompany}). Ask them to leave it before re-inviting.`,
        );
      }

      // Build the patch: always allow the role update; additionally
      // backfill company fields when the existing row is unsealed
      // (no companyName yet — likely a stale invite that never
      // completed onboarding) and the inviter can supply them.
      const patch: Record<string, unknown> = {};
      if (existing.role !== body.role) patch.role = body.role;
      if (inheritsCompany && !existingCompany) {
        Object.assign(patch, inheritedFields);
      }
      if (Object.keys(patch).length > 0) {
        await this.db.update(users).set(patch).where(eq(users.id, existing.id));
      }
      return { status: 'updated', email, role: body.role };
    }

    // Create new user with the specified role and pending status,
    // pre-seeded with the inviter's company info when available.
    const [created] = await this.db
      .insert(users)
      .values({
        email,
        role: body.role,
        inviteStatus: 'pending',
        ...inheritedFields,
      })
      .returning();

    await this.mailService.sendOrgInvitation({
      to: email,
      inviterName,
      role: body.role,
    });

    return { status: 'invited', email: created.email, role: created.role };
  }

  @Patch(':id/budget')
  async updateBudget(
    @Param('id') id: string,
    @Body() body: { budgetUsd: number },
    @CurrentUser() caller: AuthenticatedUser,
  ) {
    // Two allowed paths:
    //   1. Admin updates anyone — same role gate as /users delete.
    //   2. A user updates THEIR OWN budget, unless their profile is
    //      explicitly 'company' (where the org admin owns the spend
    //      and must approve the cap). Anything else — 'personal' or
    //      a NULL profileType from an edge-case account that never
    //      went through Private Pro onboarding cleanly — is treated
    //      as self-managed: the user pays, so the user sets the cap.
    const [callerUser] = await this.db
      .select({ role: users.role, profileType: users.profileType })
      .from(users)
      .where(eq(users.id, caller.id));
    const isAdmin = callerUser?.role === 'admin';
    const isSelfManagedUpdate =
      caller.id === id && callerUser?.profileType !== 'company';
    if (!isAdmin && !isSelfManagedUpdate) {
      throw new ForbiddenException(
        'Only admins can change another user\'s monthly budget. Company-profile basic users wait for admin approval; everyone else can self-update.',
      );
    }
    return this.usersService.updateBudget(id, body.budgetUsd);
  }

  @Patch(':id/role')
  async updateRole(
    @Param('id') id: string,
    @Body() body: { role: string },
    @CurrentUser() caller: AuthenticatedUser,
  ) {
    // Admin-only — role determines permissions across the entire org
    // (project creation, team management, user removal). Only an
    // existing admin can grant or revoke roles.
    const [callerUser] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, caller.id));
    if (!callerUser || callerUser.role !== 'admin') {
      throw new ForbiddenException(
        'Only admins can change a user\'s organization role.',
      );
    }
    // Block self-mutation: prevents an admin from accidentally
    // demoting themselves into a basic / advanced lockout. They have
    // to be demoted by another admin.
    if (id === caller.id) {
      throw new BadRequestException(
        'You cannot change your own role. Ask another admin to do it.',
      );
    }
    return this.usersService.updateRole(id, body.role);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() caller: AuthenticatedUser,
  ) {
    const [callerUser] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, caller.id));
    if (!callerUser || callerUser.role !== 'admin') {
      throw new ForbiddenException('Only admins can remove users.');
    }
    return this.usersService.remove(id, caller.id);
  }
}
