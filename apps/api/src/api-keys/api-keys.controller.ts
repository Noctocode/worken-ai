import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { ApiKeysService } from './api-keys.service.js';

@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.apiKeys.list(user.id);
  }

  /**
   * Mint a new token. The plaintext is included in the response body
   * here and ONLY here — the FE shows it in a one-time-reveal modal.
   * After this, only the prefix can be displayed.
   */
  @Post()
  mint(
    @Body() body: { name?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (typeof body?.name !== 'string') {
      throw new BadRequestException('`name` is required');
    }
    return this.apiKeys.mint(user.id, body.name);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.apiKeys.revoke(user.id, id);
  }
}
