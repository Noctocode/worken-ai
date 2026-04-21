import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { users } from '@worken/database/schema';
import { TeamsService } from './teams.service.js';
import { Public } from '../auth/public.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { DATABASE, type Database } from '../database/database.module.js';

@Controller('teams')
export class TeamsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly teamsService: TeamsService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.teamsService.findAllForUser(user.id);
  }

  @Public()
  @Get('invite/:token')
  getInviteByToken(@Param('token') token: string) {
    return this.teamsService.getInviteByToken(token);
  }

  @Post('invite/:token/accept')
  acceptInvite(
    @Param('token') token: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.acceptInviteByToken(token, user.id, user.email);
  }

  // Declared before `Delete(':id')` so the literal "invitations" segment isn't
  // captured as a team id.
  @Delete('invitations/:memberId')
  revokeInvitation(
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.revokeInvitation(memberId, user.id);
  }

  @Get(':id/invitations')
  listInvitations(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.listInvitations(id, user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.teamsService.findOne(id, user.id);
  }

  @Post()
  async create(
    @Body()
    body: {
      name: string;
      description?: string;
      monthlyBudget?: number;
      parentTeamId?: string;
    },
    @CurrentUser() caller: AuthenticatedUser,
  ) {
    const [callerUser] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, caller.id));
    if (!callerUser || callerUser.role === 'basic') {
      throw new ForbiddenException('Only admin or advanced users can create teams.');
    }

    const budgetCents = body.monthlyBudget != null
      ? Math.round(body.monthlyBudget * 100)
      : undefined;
    return this.teamsService.create(
      body.name,
      caller.id,
      caller.email,
      body.description,
      budgetCents,
      body.parentTeamId,
    );
  }

  @Delete(':id')
  deleteTeam(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.deleteTeam(id, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.update(id, user.id, body);
  }

  @Patch(':id/budget')
  updateBudget(
    @Param('id') id: string,
    @Body() body: { budgetUsd: number },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.updateBudget(id, user.id, body.budgetUsd);
  }

  @Get(':id/subteams')
  findSubteams(@Param('id') id: string) {
    return this.teamsService.findSubteams(id);
  }

  @Post(':id/members')
  inviteMember(
    @Param('id') id: string,
    @Body() body: { email: string; role: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.inviteMember(id, body.email, body.role, user.id);
  }

  @Patch(':id/members/:memberId')
  updateMemberRole(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() body: { role: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.updateMemberRole(id, memberId, body.role, user.id);
  }

  @Delete(':id/members/:memberId')
  removeMember(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.removeMember(id, memberId, user.id);
  }

  @Get(':id/guardrails')
  findGuardrails(@Param('id') id: string) {
    return this.teamsService.findGuardrails(id);
  }

  @Post(':id/guardrails')
  createGuardrail(
    @Param('id') id: string,
    @Body() body: { name: string; type: string; severity: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.createGuardrail(id, user.id, body);
  }

  @Patch(':id/guardrails/:guardrailId')
  toggleGuardrail(
    @Param('id') id: string,
    @Param('guardrailId') guardrailId: string,
    @Body() body: { isActive: boolean },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.toggleGuardrail(
      id,
      guardrailId,
      user.id,
      body.isActive,
    );
  }

  @Delete(':id/guardrails/:guardrailId')
  deleteGuardrail(
    @Param('id') id: string,
    @Param('guardrailId') guardrailId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.deleteGuardrail(id, guardrailId, user.id);
  }
}
