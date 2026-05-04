import {
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import {
  ApiKeysService,
  API_KEY_PREFIX,
  hashApiKey,
} from '../api-keys/api-keys.service.js';
import { UsersService } from '../users/users.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import type { AuthenticatedUser } from './types.js';

/**
 * Auth guard for the entire app. Tries the existing JWT cookie path
 * first (FE login flow). If no cookie OR JWT is rejected, falls back to
 * `Authorization: Bearer sk-wai-…` API key auth so external clients
 * (CI/CD, scripts, mobile, integrations) can call the same endpoints.
 *
 * On API-key success, attaches an `AuthenticatedUser` shaped exactly
 * like the JWT path so `CurrentUser` works transparently downstream,
 * and fires off a non-awaited `lastUsedAt` update.
 */
@Injectable()
export class JwtOrApiKeyGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtOrApiKeyGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeysService: ApiKeysService,
    private readonly usersService: UsersService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();

    // Cookie auth has priority — the FE always sends it. If a JWT cookie
    // is present and valid the request is authenticated as that user.
    const hasJwtCookie = !!(req.cookies as Record<string, string> | undefined)
      ?.access_token;

    if (hasJwtCookie) {
      try {
        const ok = (await super.canActivate(context)) as boolean;
        if (ok) return true;
      } catch {
        // fall through to API key path
      }
    }

    // API key path: must be `Authorization: Bearer sk-wai-…`.
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length).trim();
      if (token.startsWith(API_KEY_PREFIX)) {
        const user = await this.authenticateApiKey(token, req);
        if (user) return true;
      }
    }

    throw new UnauthorizedException();
  }

  private async authenticateApiKey(
    token: string,
    req: Request,
  ): Promise<AuthenticatedUser | null> {
    const hash = hashApiKey(token);
    const row = await this.apiKeysService.findActiveByHash(hash);
    if (!row) return null;

    // Need email to populate AuthenticatedUser the same shape as JWT path.
    const owner = await this.usersService.findById(row.ownerId);
    if (!owner) return null;

    const user: AuthenticatedUser = { id: owner.id, email: owner.email };
    (req as Request & { user?: AuthenticatedUser }).user = user;

    // Fire-and-forget — never block the request on the timestamp write,
    // and a failure here shouldn't 500 a successful API call.
    this.apiKeysService.touchLastUsed(row.id).catch((err) => {
      this.logger.warn(
        `Failed to update lastUsedAt for api key ${row.id}: ${
          (err as Error).message
        }`,
      );
    });

    return user;
  }
}
