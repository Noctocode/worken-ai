import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import type { Request } from 'express';
import type { AuthenticatedUser } from './types.js';

function extractJwtFromCookie(req: Request): string | null {
  return (
    (req.cookies as Record<string, string> | undefined)?.access_token ?? null
  );
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: extractJwtFromCookie,
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow('JWT_SECRET'),
    });
  }

  validate(payload: {
    sub: string;
    email: string;
    isPaid: boolean;
  }): AuthenticatedUser {
    return {
      id: payload.sub,
      email: payload.email,
      isPaid: payload.isPaid ?? false,
    };
  }
}
