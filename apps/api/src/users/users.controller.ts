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
  findAll() {
    return this.usersService.findAll();
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

    if (existing) {
      // Block cross-company invites: if the target already onboarded
      // under a different `companyName`, we can't quietly absorb them
      // into this org without overwriting their workspace identity.
      // Pre-onboarding rows (companyName=null) and matching companies
      // pass through. The admin sees a clean 409 instead of two users
      // ending up with mismatched Company-tab views.
      const inviterCompany = callerUser.companyName?.trim();
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
      // Update role if needed
      if (existing.role !== body.role) {
        await this.db
          .update(users)
          .set({ role: body.role })
          .where(eq(users.id, existing.id));
      }
      return { status: 'updated', email, role: body.role };
    }

    // Create new user with the specified role and pending status
    const [created] = await this.db
      .insert(users)
      .values({ email, role: body.role, inviteStatus: 'pending' })
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
    // Budget changes flip a real spend cap on the user's OpenRouter
    // sub-account — basic / advanced users must not be able to lift
    // each other's caps. Mirror the role gate used on /users delete.
    const [callerUser] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, caller.id));
    if (!callerUser || callerUser.role !== 'admin') {
      throw new ForbiddenException(
        'Only admins can change a user\'s monthly budget.',
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
