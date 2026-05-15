import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OrgSettingsController } from './org-settings.controller.js';
import { OrgSettingsService } from './org-settings.service.js';

@Module({
  imports: [NotificationsModule],
  controllers: [OrgSettingsController],
  providers: [OrgSettingsService],
  exports: [OrgSettingsService],
})
export class OrgSettingsModule {}
