import { Module } from '@nestjs/common';
import { KnowledgeCoreController } from './knowledge-core.controller.js';
import { KnowledgeCoreService } from './knowledge-core.service.js';

@Module({
  controllers: [KnowledgeCoreController],
  providers: [KnowledgeCoreService],
  exports: [KnowledgeCoreService],
})
export class KnowledgeCoreModule {}
