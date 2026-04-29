import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
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

  /** Admin: full OpenRouter catalog with per-model enabled flag. */
  @Get('catalog')
  catalog(@CurrentUser() user: AuthenticatedUser) {
    return this.modelsService.listCatalog(user.id);
  }

  /** Any authenticated user: only the admin-enabled subset. Drives FE pickers. */
  @Get('available')
  available() {
    return this.modelsService.listAvailable();
  }

  /** Admin: toggle a single model. */
  @Patch('catalog/:modelIdentifier(*)/enabled')
  setEnabled(
    @Param('modelIdentifier') modelIdentifier: string,
    @Body() body: { enabled: boolean },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('`enabled` must be a boolean');
    }
    return this.modelsService.setEnabled(user.id, modelIdentifier, body.enabled);
  }

  /** Admin: replace the entire enabled set with this list. */
  @Put('catalog/enabled')
  setEnabledBulk(
    @Body() body: { modelIdentifiers: string[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!Array.isArray(body?.modelIdentifiers)) {
      throw new BadRequestException('`modelIdentifiers` must be an array');
    }
    return this.modelsService.setEnabledBulk(user.id, body.modelIdentifiers);
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
