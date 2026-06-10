import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ModelsService } from './models.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';

@Controller('models')
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.modelsService.findAll(user.id);
  }

  /** The full OpenRouter catalog. Drives FE model pickers. */
  @Get('available')
  available() {
    return this.modelsService.listAvailable();
  }

  /**
   * Per-user effective model list for FE pickers (arena / project chat).
   * Combines the user's own model_configs aliases with any catalog
   * model for a provider where the user has an enabled BYOK key.
   *
   * Optional `scope` narrows the pool for the Create Project picker:
   *   - "personal"  → only the caller's personal keys/aliases
   *   - "<teamId>"  → only what's enabled at that team
   *   - omitted     → the full union (arena / chat behaviour)
   */
  @Get('effective')
  effective(
    @CurrentUser() user: AuthenticatedUser,
    @Query('scope') scope?: string,
  ) {
    const resolvedScope =
      !scope
        ? undefined
        : scope === 'personal'
          ? { teamId: null }
          : { teamId: scope };
    return this.modelsService.listEffectiveForUser(user.id, resolvedScope);
  }

  @Post()
  create(
    @Body()
    body: {
      customName: string;
      modelIdentifier: string;
      fallbackModels?: string[];
      integrationId?: string | null;
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
      integrationId?: string | null;
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
