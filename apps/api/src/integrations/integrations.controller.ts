import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { IntegrationsService } from './integrations.service.js';

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  /** Public catalog of predefined providers (no per-user state). */
  @Get('providers')
  listProviders() {
    return this.integrationsService.listPredefined();
  }

  /** User's integration cards: predefined (always present) + custom LLMs. */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.integrationsService.listForUser(user.id);
  }

  /**
   * Create custom LLM (providerId="custom" + apiUrl) or upsert BYOK
   * settings on a predefined provider (providerId="openai", apiKey, …).
   */
  @Post()
  create(
    @Body()
    body: {
      providerId: string;
      apiUrl?: string;
      apiKey?: string;
      isEnabled?: boolean;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (typeof body?.providerId !== 'string' || !body.providerId) {
      throw new BadRequestException('`providerId` is required');
    }
    return this.integrationsService.upsert(user.id, {
      providerId: body.providerId,
      apiUrl: body.apiUrl,
      apiKey: body.apiKey,
      isEnabled: body.isEnabled,
    });
  }

  /** Toggle is_enabled and/or update the BYOK key. */
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { isEnabled?: boolean; apiKey?: string | null },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.integrationsService.update(user.id, id, body);
  }

  /** Custom LLMs only — predefined rows can be disabled but not removed. */
  @Delete(':id')
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.integrationsService.remove(user.id, id);
  }
}
