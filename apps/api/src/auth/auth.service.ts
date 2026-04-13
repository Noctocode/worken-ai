import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { users, teamMembers } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { REDIS } from '../redis/redis.module.js';
import { TeamsService } from '../teams/teams.service.js';
import type Redis from 'ioredis';
import type { GoogleProfile } from './types.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly teamsService: TeamsService,
  ) {}

  async validateOrCreateUser(profile: GoogleProfile) {
    const [existing] = await this.db
      .select()
      .from(users)
      .where(eq(users.googleId, profile.googleId));

    if (existing) {
      // Update name/picture if changed
      const [updated] = await this.db
        .update(users)
        .set({
          name: profile.name,
          picture: profile.picture,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning();
      return updated;
    }

    // An email-registered user signed in with Google for the first time —
    // link the accounts by attaching the googleId instead of creating a duplicate.
    const [emailMatch] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, profile.email));
    if (emailMatch) {
      const [linked] = await this.db
        .update(users)
        .set({
          googleId: profile.googleId,
          name: emailMatch.name ?? profile.name,
          picture: emailMatch.picture ?? profile.picture,
          updatedAt: new Date(),
        })
        .where(eq(users.id, emailMatch.id))
        .returning();
      return linked;
    }

    const [user] = await this.db
      .insert(users)
      .values({
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
        googleId: profile.googleId,
      })
      .returning();
    return user;
  }

  // TODO: email verification before prod — currently anyone can claim any
  // email. The invite flow proves email ownership via the token, but
  // standalone signups do not. Add a verification-email step before launch.
  // TODO: rate limiting / bruteforce protection on /auth/signup.
  async signupWithPassword(input: {
    email: string;
    password: string;
    name: string;
  }) {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    const password = input.password;

    if (!EMAIL_RE.test(email)) {
      throw new BadRequestException('Please enter a valid email address');
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    if (!name) {
      throw new BadRequestException('Name is required');
    }

    const [existing] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email));

    if (existing) {
      if (existing.passwordHash) {
        throw new ConflictException(
          'An account with this email already exists',
        );
      }
      if (existing.googleId) {
        throw new ConflictException(
          'This email is already registered with Google. Please sign in with Google.',
        );
      }
      // Row exists with neither credential (shouldn't happen) — refuse rather
      // than silently take it over.
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await argon2.hash(password);

    const [user] = await this.db
      .insert(users)
      .values({ email, name, passwordHash })
      .returning();

    return user;
  }

  // TODO: rate limiting / bruteforce protection on /auth/login.
  async loginWithPassword(emailInput: string, password: string) {
    const email = emailInput.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || !password) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email));

    // Uniform error so we don't leak which emails are registered.
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return user;
  }

  async generateTokens(userId: string, email: string, isPaid: boolean) {
    const accessToken = this.jwt.sign(
      { sub: userId, email, isPaid },
      {
        secret: this.config.getOrThrow('JWT_SECRET'),
        expiresIn: '15m',
      },
    );

    const refreshToken = this.jwt.sign(
      { sub: userId },
      {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      },
    );

    // Store refresh token in Redis with 7-day TTL
    await this.redis.set(
      `refresh:${userId}`,
      refreshToken,
      'EX',
      7 * 24 * 60 * 60,
    );

    return { accessToken, refreshToken };
  }

  async refreshAccessToken(refreshToken: string) {
    let payload: { sub: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const stored = await this.redis.get(`refresh:${payload.sub}`);
    if (!stored || stored !== refreshToken) {
      throw new UnauthorizedException('Refresh token revoked');
    }

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, payload.sub));
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.generateTokens(user.id, user.email, user.isPaid);
  }

  async logout(userId: string) {
    await this.redis.del(`refresh:${userId}`);
  }

  async getUser(userId: string) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId));
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const canCreateProject =
      user.isPaid ||
      (await this.teamsService.userHasAdvancedRoleInAnyTeam(userId));

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      isPaid: user.isPaid,
      canCreateProject,
    };
  }

  async processTeamInvitations(userId: string, email: string) {
    // Only auto-accept invites that are still live: not revoked and not expired.
    // NULL invitationStatus/invitationExpiresAt are legacy rows from before the
    // expiry feature — treat them as still valid pending invites.
    await this.db
      .update(teamMembers)
      .set({
        userId,
        status: 'accepted',
        invitationToken: null,
        invitationStatus: 'accepted',
        // TODO: temporary 2026-04-13 — all users get advanced until permissions are finalized.
        // Revert by removing this line so the role from the invitation is preserved.
        role: 'advanced',
      })
      .where(
        and(
          eq(teamMembers.email, email),
          eq(teamMembers.status, 'pending'),
          isNull(teamMembers.invitationRevokedAt),
          or(
            isNull(teamMembers.invitationStatus),
            eq(teamMembers.invitationStatus, 'pending'),
          ),
          or(
            isNull(teamMembers.invitationExpiresAt),
            gt(teamMembers.invitationExpiresAt, new Date()),
          ),
        ),
      );
  }
}
