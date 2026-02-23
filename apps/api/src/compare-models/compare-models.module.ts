import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CompareModelsController } from './compare-models.controller.js';
import { CompareModelsService } from './compare-models.service.js';

@Module({
  imports: [ConfigModule],
  controllers: [CompareModelsController],
  providers: [CompareModelsService],
})
export class CompareModelsModule {}
