import { Module } from '@nestjs/common';
import { OrgSettingsController } from './org-settings.controller.js';
import { OrgSettingsService } from './org-settings.service.js';

@Module({
  controllers: [OrgSettingsController],
  providers: [OrgSettingsService],
  exports: [OrgSettingsService],
})
export class OrgSettingsModule {}
