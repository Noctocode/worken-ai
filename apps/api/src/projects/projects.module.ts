import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { ProjectKnowledgeService } from './project-knowledge.service.js';
import { KnowledgeCoreModule } from '../knowledge-core/knowledge-core.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TeamsModule } from '../teams/teams.module.js';

@Module({
  imports: [TeamsModule, NotificationsModule, KnowledgeCoreModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectKnowledgeService],
  exports: [ProjectKnowledgeService],
})
export class ProjectsModule {}
