import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { eq } from 'drizzle-orm';
import { users } from '@worken/database/schema';
import type { Request } from 'express';
import { DATABASE, type Database } from '../database/database.module.js';
import type { AuthenticatedUser } from './types.js';

function extractJwtFromCookie(req: Request): string | null {
  return (
    (req.cookies as Record<string, string> | undefined)?.access_token ?? null
  );
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @Inject(DATABASE) private readonly db: Database,
  ) {
    super({
      jwtFromRequest: extractJwtFromCookie,
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow('JWT_SECRET'),
    });
  }

  // A signature-valid token isn't enough: the user it points at may have
  // been deleted (or wiped in a dev reset) while the cookie is still
  // unexpired. Confirm the row exists so every guarded endpoint rejects a
  // ghost session with a clean 401 — instead of trusting the token and
  // 500-ing downstream when the missing user breaks an assumption. The
  // 401 also lets the FE's refresh→/login recovery kick in.
  async validate(payload: {
    sub: string;
    email: string;
  }): Promise<AuthenticatedUser> {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return {
      id: payload.sub,
      email: payload.email,
    };
  }
}
