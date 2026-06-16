import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { SkillRouterService } from './skill-router.service.js';
import { SkillsController } from './skills.controller.js';
import { SkillsService } from './skills.service.js';

@Module({
  imports: [DocumentsModule, IntegrationsModule],
  controllers: [SkillsController],
  providers: [SkillsService, SkillRouterService],
  // Exported so the chat / arena paths can select + inject skills per turn.
  exports: [SkillsService, SkillRouterService],
})
export class SkillsModule {}
