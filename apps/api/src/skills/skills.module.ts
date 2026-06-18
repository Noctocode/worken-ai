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
import { ContainerSandbox } from './container-sandbox.js';
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
    // Sandbox runtime selection. Default OFF → deny-by-default (no untrusted
    // code runs). Set SKILL_SANDBOX_DOCKER=true to enable the hardened
    // self-hosted container runtime where a Docker daemon is available.
    {
      provide: SKILL_SANDBOX,
      useFactory: () =>
        process.env['SKILL_SANDBOX_DOCKER'] === 'true'
          ? new ContainerSandbox()
          : new UnavailableSandboxRuntime(),
    },
  ],
  // Exported so the chat / arena paths can select + inject skills per turn.
  exports: [SkillsService, SkillRouterService],
})
export class SkillsModule {}
