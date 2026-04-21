import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import { TeamsService } from '../teams/teams.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { users } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { MailService } from '../mail/mail.service.js';

@Controller('users')
export class UsersController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
    private readonly mailService: MailService,
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

    if (existing) {
      // Update role if needed
      if (existing.role !== body.role) {
        await this.db
          .update(users)
          .set({ role: body.role })
          .where(eq(users.id, existing.id));
      }
      return { status: 'updated', email, role: body.role };
    }

    // Create new user with the specified role
    const [created] = await this.db
      .insert(users)
      .values({ email, role: body.role })
      .returning();

    return { status: 'invited', email: created.email, role: created.role };
  }

  @Patch(':id/budget')
  updateBudget(
    @Param('id') id: string,
    @Body() body: { budgetUsd: number },
  ) {
    return this.usersService.updateBudget(id, body.budgetUsd);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() caller: AuthenticatedUser,
  ) {
    const canManage =
      await this.teamsService.userHasAdvancedRoleInAnyTeam(caller.id);
    if (!canManage) {
      throw new ForbiddenException(
        'An advanced team role is required to remove users.',
      );
    }
    return this.usersService.remove(id, caller.id);
  }
}
