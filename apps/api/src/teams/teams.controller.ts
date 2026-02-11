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
    @Body() body: { name: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.create(body.name, user.id, user.email);
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
}
