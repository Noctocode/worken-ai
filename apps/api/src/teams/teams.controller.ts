import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TeamsService } from './teams.service.js';
import { PaidGuard } from '../auth/paid.guard.js';
import { Public } from '../auth/public.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';

@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

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

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.teamsService.findOne(id, user.id);
  }

  @Post()
  @UseGuards(PaidGuard)
  create(
    @Body()
    body: {
      name: string;
      description?: string;
      monthlyBudget?: number;
      parentTeamId?: string;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const budgetCents = body.monthlyBudget != null
      ? Math.round(body.monthlyBudget * 100)
      : undefined;
    return this.teamsService.create(
      body.name,
      user.id,
      user.email,
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
