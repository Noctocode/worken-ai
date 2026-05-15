import { forwardRef, Module } from '@nestjs/common';
import { TeamsModule } from '../teams/teams.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  // forwardRef matches the TeamsModule side; without it Nest can't
  // resolve the cycle on first boot.
  imports: [forwardRef(() => TeamsModule)],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
