import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedRequest } from '../auth/jwt-or-api-key.guard.js';
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
   * Mint a new token. Plaintext is included in the response body here
   * and ONLY here — the FE shows it in a one-time-reveal modal. After
   * this, only the prefix can be displayed.
   *
   * Defense in depth: minting is restricted to cookie-authenticated
   * sessions. If a token leaks, an attacker holding it can't use it to
   * mint replacement tokens that would survive the victim revoking the
   * leaked one. They'd need to compromise the actual user account.
   */
  @Post()
  mint(
    @Body() body: { name?: string },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request & AuthenticatedRequest,
  ) {
    if (req.authMethod === 'apikey') {
      throw new ForbiddenException(
        'API keys cannot be minted via API key auth. Sign in to the WorkenAI app and create the key from Management → API.',
      );
    }
    return this.apiKeys.mint(user.id, body?.name ?? '');
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
