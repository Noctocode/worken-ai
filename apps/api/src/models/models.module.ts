import { Module } from '@nestjs/common';
import { ModelsController } from './models.controller.js';
import { ModelsService } from './models.service.js';
import { OpenRouterCatalogService } from './openrouter-catalog.service.js';

@Module({
  controllers: [ModelsController],
  providers: [ModelsService, OpenRouterCatalogService],
  exports: [ModelsService, OpenRouterCatalogService],
})
export class ModelsModule {}
