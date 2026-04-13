import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ModelsService } from './models.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';

@Controller('models')
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  @Get()
  findAll() {
    return this.modelsService.findAll();
  }

  @Post()
  create(
    @Body()
    body: {
      customName: string;
      modelIdentifier: string;
      fallbackModels?: string[];
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.modelsService.create(user.id, body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      customName?: string;
      modelIdentifier?: string;
      isActive?: boolean;
      fallbackModels?: string[];
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.modelsService.update(id, user.id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.modelsService.remove(id, user.id);
  }
}
