import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { users, teamMembers } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { REDIS } from '../redis/redis.module.js';
import { TeamsService } from '../teams/teams.service.js';
import type Redis from 'ioredis';
import type { GoogleProfile } from './types.js';

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
    await this.db
      .update(teamMembers)
      .set({ userId, status: 'accepted', invitationToken: null })
      .where(
        and(eq(teamMembers.email, email), eq(teamMembers.status, 'pending')),
      );
  }
}
