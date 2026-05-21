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
import {
  INVITE_ERROR_MESSAGES,
  TeamsService,
} from '../teams/teams.service.js';
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
    try {
      const accepted = await this.teams.acceptInviteByToken(
        token,
        user.id,
        user.email,
      );
      await this.notifications.markActed(id, user.id);
      return {
        type: row.type,
        teamId: accepted.teamId,
        alreadyResolved: false,
      };
    } catch (err) {
      // Idempotency for terminal-state invites. If the underlying
      // team_members row was already finalised — accepted via the
      // email link in another tab, expired by the sweep, or revoked
      // by the inviter — TeamsService throws a BadRequestException
      // with one of the INVITE_ERROR_MESSAGES strings. The action
      // button is now moot, so we mark the notification 'acted' and
      // report the terminal state to the FE rather than bubbling an
      // error. Without this the notification stays 'pending' and the
      // Accept/Decline buttons re-enable on every popover open,
      // re-firing the same 400. Any other error (network, FK, etc.)
      // re-throws so it can be surfaced as a real failure.
      //
      // Identity-match (===) against the shared constants instead of
      // substring-grepping err.message: renaming a message literal
      // in teams.service.ts would otherwise silently route a real
      // terminal error to the fallback re-throw — the shared const
      // makes the coupling explicit and survives typo-grade edits.
      const msg = err instanceof BadRequestException ? err.message : '';
      const isAlreadyAccepted = msg === INVITE_ERROR_MESSAGES.ALREADY_ACCEPTED;
      const isExpired = msg === INVITE_ERROR_MESSAGES.EXPIRED;
      const isRevoked = msg === INVITE_ERROR_MESSAGES.REVOKED;
      if (isAlreadyAccepted || isExpired || isRevoked) {
        await this.notifications.markActed(id, user.id);
        return {
          type: row.type,
          alreadyResolved: true,
          terminalState: isAlreadyAccepted
            ? ('accepted' as const)
            : isExpired
              ? ('expired' as const)
              : ('declined' as const),
        };
      }
      throw err;
    }
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
