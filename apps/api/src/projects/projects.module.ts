import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { ProjectKnowledgeService } from './project-knowledge.service.js';
import { ProjectMembersService } from './project-members.service.js';
import { KnowledgeCoreModule } from '../knowledge-core/knowledge-core.module.js';
import { MailModule } from '../mail/mail.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TeamsModule } from '../teams/teams.module.js';

@Module({
  imports: [TeamsModule, NotificationsModule, KnowledgeCoreModule, MailModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectKnowledgeService, ProjectMembersService],
  exports: [ProjectKnowledgeService],
})
export class ProjectsModule {}
