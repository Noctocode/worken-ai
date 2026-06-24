import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import {
  ToolsService,
  type CreateToolInput,
  type UpdateToolInput,
} from './tools.service.js';

// Admin-only mutation is enforced in the service (requireAdminCompany); the
// list/get are readable by any company member so the Tools tab renders the
// same catalog for everyone (company-wide consistency).
@Controller('tools')
export class ToolsController {
  constructor(private readonly tools: ToolsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.tools.list(user.id);
  }

  @Get(':id')
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tools.get(id, user.id);
  }

  @Post()
  create(
    @Body() body: CreateToolInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tools.create(user.id, body);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateToolInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tools.update(id, user.id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.tools.delete(id, user.id);
  }
}
