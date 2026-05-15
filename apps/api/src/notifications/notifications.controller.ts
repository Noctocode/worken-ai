import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { TeamsService } from '../teams/teams.service.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly teams: TeamsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.findForUser(user.id);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthenticatedUser) {
    const count = await this.notifications.unreadCount(user.id);
    return { count };
  }

  @Patch(':id/read')
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notifications.markRead(id, user.id);
  }

  @Patch('read-all')
  @HttpCode(200)
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.id);
  }

  /**
   * Accept an actionable notification. Today only team_invite is
   * supported — org_invite is auto-accepted server-side at user-
   * row creation time, budget_alert is info-only. Delegates the
   * real work to TeamsService.acceptInviteByToken so there's one
   * source of truth for flipping membership rows.
   */
  @Post(':id/accept')
  @HttpCode(200)
  async accept(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const row = await this.notifications.getForCaller(id, user.id);
    if (row.status !== 'pending') {
      throw new BadRequestException(
        'This notification has already been resolved.',
      );
    }
    if (row.type !== 'team_invite') {
      throw new BadRequestException(
        `Notifications of type '${row.type}' don't support Accept.`,
      );
    }
    const data = (row.data ?? {}) as Record<string, unknown>;
    const token =
      typeof data.invitationToken === 'string' ? data.invitationToken : null;
    if (!token) {
      throw new BadRequestException(
        'Invitation token missing from this notification — accept via the email link.',
      );
    }
    const accepted = await this.teams.acceptInviteByToken(
      token,
      user.id,
      user.email,
    );
    await this.notifications.markActed(id, user.id);
    return { type: row.type, teamId: accepted.teamId };
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notifications.declineTeamInvite(id, user.id);
  }

  @Delete(':id')
  @HttpCode(200)
  dismiss(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notifications.dismiss(id, user.id);
  }
}
