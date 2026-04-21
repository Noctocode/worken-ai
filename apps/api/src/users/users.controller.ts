import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import { TeamsService } from '../teams/teams.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
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
