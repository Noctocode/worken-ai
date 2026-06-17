import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { KnowledgeCoreModule } from '../knowledge-core/knowledge-core.module.js';
import { OrgSettingsModule } from '../org-settings/org-settings.module.js';
import { SkillRouterService } from './skill-router.service.js';
import { ToolRegistryService } from './tool-registry.service.js';
import { SkillExecutionService } from './skill-execution.service.js';
import { SkillsController } from './skills.controller.js';
import { SkillsService } from './skills.service.js';

@Module({
  // KnowledgeCoreModule provides KnowledgeIngestionService, which the
  // executable-skills ToolRegistry uses for the caller-scoped kc_search /
  // read_attached_file tools.
  imports: [
    DocumentsModule,
    IntegrationsModule,
    KnowledgeCoreModule,
    OrgSettingsModule,
  ],
  controllers: [SkillsController],
  providers: [
    SkillsService,
    SkillRouterService,
    ToolRegistryService,
    SkillExecutionService,
  ],
  // Exported so the chat / arena paths can select + inject skills per turn.
  exports: [SkillsService, SkillRouterService],
})
export class SkillsModule {}
