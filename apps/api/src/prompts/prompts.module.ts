import { Module } from '@nestjs/common';
import { PromptsController } from './prompts.controller.js';

@Module({
  controllers: [PromptsController],
})
export class PromptsModule {}
