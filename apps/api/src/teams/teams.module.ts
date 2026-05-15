import { forwardRef, Module } from '@nestjs/common';
import { TeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';
import { MailModule } from '../mail/mail.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';

@Module({
  // forwardRef breaks the TeamsModule <-> NotificationsModule cycle —
  // teams enqueues `team_invite` notifications, notifications calls
  // back into TeamsService for accept(). Nest resolves the lazy ref
  // at runtime once both modules are registered.
  imports: [
    MailModule,
    OpenRouterModule,
    forwardRef(() => NotificationsModule),
  ],
  controllers: [TeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
