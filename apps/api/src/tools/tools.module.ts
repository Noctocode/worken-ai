import { Module } from '@nestjs/common';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';
import { ToolsController } from './tools.controller.js';
import { ToolsService } from './tools.service.js';

@Module({
  // OpenRouter brings EncryptionService used to encrypt each tool's API key.
  imports: [OpenRouterModule],
  controllers: [ToolsController],
  providers: [ToolsService],
  // Exported so the later chat tool-call phase can resolve + execute tools.
  exports: [ToolsService],
})
export class ToolsModule {}
