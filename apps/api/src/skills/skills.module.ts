import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { KnowledgeCoreModule } from '../knowledge-core/knowledge-core.module.js';
import { ModelsModule } from '../models/models.module.js';
import { ObservabilityModule } from '../observability/observability.module.js';
import { OrgSettingsModule } from '../org-settings/org-settings.module.js';
import { SkillRouterService } from './skill-router.service.js';
import { ToolRegistryService } from './tool-registry.service.js';
import { SkillExecutionService } from './skill-execution.service.js';
import { SKILL_SANDBOX, UnavailableSandboxRuntime } from './skill-sandbox.js';
import { SkillArtifactService } from './skill-artifact.service.js';
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
    ModelsModule,
    ObservabilityModule,
    OrgSettingsModule,
  ],
  controllers: [SkillsController],
  providers: [
    SkillsService,
    SkillRouterService,
    ToolRegistryService,
    SkillExecutionService,
    SkillArtifactService,
    // Deny-by-default sandbox: no untrusted code runs until a real runtime
    // (Anthropic code-exec / self-hosted worker) is wired behind this token.
    { provide: SKILL_SANDBOX, useClass: UnavailableSandboxRuntime },
  ],
  // Exported so the chat / arena paths can select + inject skills per turn.
  exports: [SkillsService, SkillRouterService],
})
export class SkillsModule {}
