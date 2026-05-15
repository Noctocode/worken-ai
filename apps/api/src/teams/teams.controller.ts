import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
    @Body()
    body: {
      email: string;
      role: string;
      /** Optional per-member monthly cap in cents. See
       *  TeamsService.inviteMember for semantics. */
      monthlyCapCents?: number | null;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.inviteMember(
      id,
      body.email,
      body.role,
      user.id,
      body.monthlyCapCents,
    );
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

  // Per-team guardrail listing. Returns rules linked to this team via
  // `guardrail_teams`. Create / toggle / unlink now live on
  // /guardrails-section so a single rule definition can be linked to
  // multiple teams instead of duplicated per team.
  @Get(':id/guardrails')
  findGuardrails(@Param('id') id: string) {
    return this.teamsService.findGuardrails(id);
  }

  // ─── Integration links (picker model) ──────────────────────────
  //
  // Replaces the legacy team-scoped /integrations endpoints above:
  // instead of pushing the encrypted key into a separate row per
  // team, admins configure their key once on /teams?tab=integration
  // and link it into one or more teams via these endpoints. The old
  // routes stay during the FE migration but no longer receive new
  // writes from the picker.

  @Get(':id/integration-links')
  listIntegrationLinks(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.listIntegrationLinks(id, user.id);
  }

  // Caller's personal integrations + which are already linked. Drives
  // the picker UI on team-details — split from `integration-links` so
  // the read for the picker doesn't need to join in linkage state
  // that's already on the linked list.
  @Get(':id/integration-links/linkable')
  listLinkableIntegrations(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.listLinkableIntegrations(id, user.id);
  }

  @Put(':id/integration-links')
  setIntegrationLinks(
    @Param('id') id: string,
    @Body() body: { integrationIds?: string[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!Array.isArray(body?.integrationIds)) {
      throw new BadRequestException('`integrationIds` must be an array.');
    }
    return this.teamsService.setIntegrationLinks(
      id,
      user.id,
      body.integrationIds,
    );
  }

  @Patch(':id/integration-links/:integrationId')
  setIntegrationLinkEnabled(
    @Param('id') id: string,
    @Param('integrationId', new ParseUUIDPipe()) integrationId: string,
    @Body() body: { isEnabled?: boolean },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (typeof body?.isEnabled !== 'boolean') {
      throw new BadRequestException('`isEnabled` must be a boolean.');
    }
    return this.teamsService.setIntegrationLinkEnabled(
      id,
      user.id,
      integrationId,
      body.isEnabled,
    );
  }

  // Per-member monthly cap. Body accepts a number (cents) or null to
  // remove the cap. 0 = suspend the member (chat-time gate blocks).
  // memberId is validated as a UUID up-front so a malformed path
  // segment fails as a clean 400 instead of a Postgres cast error
  // bubbling up as a 500 from the service-layer query.
  @Patch(':id/members/:memberId/cap')
  updateMemberCap(
    @Param('id') id: string,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Body() body: { monthlyCapCents: number | null },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.updateMemberCap(
      id,
      memberId,
      body.monthlyCapCents,
      user.id,
    );
  }
}
