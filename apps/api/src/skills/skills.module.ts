import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { SkillsController } from './skills.controller.js';
import { SkillsService } from './skills.service.js';

@Module({
  imports: [DocumentsModule],
  controllers: [SkillsController],
  providers: [SkillsService],
  // Exported so the chat / arena paths can reuse the embedding +
  // accessible-skill logic via the router service (added in a later commit).
  exports: [SkillsService],
})
export class SkillsModule {}
