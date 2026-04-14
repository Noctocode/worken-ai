import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { users, teamMembers } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { REDIS } from '../redis/redis.module.js';
import { TeamsService } from '../teams/teams.service.js';
import type Redis from 'ioredis';
import type { GoogleProfile } from './types.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1h

function generateVerificationToken() {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

function hashVerificationToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

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
    // Normalize so Google (User@X.com) and password auth (user@x.com) resolve
    // to the same row — otherwise account linking misses and we create a
    // duplicate.
    const email = profile.email.trim().toLowerCase();

    const [existing] = await this.db
      .select()
      .from(users)
      .where(eq(users.googleId, profile.googleId));

    if (existing) {
      // Update name/picture if changed; ensure emailVerifiedAt is set since
      // Google has already proven ownership of this email.
      const [updated] = await this.db
        .update(users)
        .set({
          name: profile.name,
          picture: profile.picture,
          emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning();
      return updated;
    }

    // An email-registered user signed in with Google for the first time —
    // link the accounts by attaching the googleId instead of creating a
    // duplicate. Google proves the email so we mark it verified now.
    const [emailMatch] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email));
    if (emailMatch) {
      const [linked] = await this.db
        .update(users)
        .set({
          googleId: profile.googleId,
          name: emailMatch.name ?? profile.name,
          picture: emailMatch.picture ?? profile.picture,
          emailVerifiedAt: emailMatch.emailVerifiedAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, emailMatch.id))
        .returning();
      return linked;
    }

    const [user] = await this.db
      .insert(users)
      .values({
        email,
        name: profile.name,
        picture: profile.picture,
        googleId: profile.googleId,
        emailVerifiedAt: new Date(),
      })
      .returning();
    return user;
  }

  // TODO: rate limiting / bruteforce protection on /auth/signup.
  async signupWithPassword(input: {
    email: string;
    password: string;
    name: string;
    autoVerify?: boolean; // set by invite flow — token already proves the email
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
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await argon2.hash(password);

    // When auto-verifying (invite flow), skip the token ceremony entirely.
    // Otherwise issue a token and stash its hash for /auth/verify to check.
    let verificationToken: string | null = null;
    const verificationFields: {
      emailVerifiedAt: Date | null;
      verificationTokenHash: string | null;
      verificationTokenExpiresAt: Date | null;
    } = {
      emailVerifiedAt: null,
      verificationTokenHash: null,
      verificationTokenExpiresAt: null,
    };
    if (input.autoVerify) {
      verificationFields.emailVerifiedAt = new Date();
    } else {
      const { token, hash } = generateVerificationToken();
      verificationToken = token;
      verificationFields.verificationTokenHash = hash;
      verificationFields.verificationTokenExpiresAt = new Date(
        Date.now() + VERIFICATION_TTL_MS,
      );
    }

    const [user] = await this.db
      .insert(users)
      .values({ email, name, passwordHash, ...verificationFields })
      .returning();

    return { user, verificationToken };
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

    // Uniform 401 so we don't leak which emails are registered.
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Only valid credentials reveal the "not verified" state — that way an
    // attacker can't probe which emails exist.
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'EMAIL_NOT_VERIFIED',
        message:
          'Please verify your email before signing in. Check your inbox for the confirmation link.',
      });
    }

    return user;
  }

  /**
   * Consume a verification token. Marks the email verified and clears the
   * expiry (keeping the hash so a legitimate re-click is idempotent rather
   * than looking "invalid"). Rejects expired and unknown tokens.
   *
   * Token states represented by (hash, expires_at):
   *   (hash, future) → unused, valid
   *   (hash, null)   → consumed (idempotent re-click returns user silently)
   *   (hash, past)   → expired
   *   (null, _)      → never existed or replaced by a newer resend
   */
  async verifyEmailToken(rawToken: string) {
    if (!rawToken) {
      throw new BadRequestException('Missing verification token');
    }
    const providedHash = hashVerificationToken(rawToken);

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.verificationTokenHash, providedHash));

    if (!user || !user.verificationTokenHash) {
      throw new BadRequestException('Invalid or already-used verification link');
    }

    // Constant-time defense-in-depth.
    const a = Buffer.from(providedHash, 'hex');
    const b = Buffer.from(user.verificationTokenHash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new BadRequestException('Invalid or already-used verification link');
    }

    // expires_at null = already consumed → re-click is idempotent.
    if (user.verificationTokenExpiresAt === null) {
      return user;
    }

    if (user.verificationTokenExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Verification link has expired');
    }

    const [updated] = await this.db
      .update(users)
      .set({
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        verificationTokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();

    return updated;
  }

  /**
   * Generate + persist a fresh verification token for an existing user.
   * Returns the raw token so the caller can dispatch an email. Callers
   * should swallow "user not found" / "already verified" to avoid email
   * enumeration; this method simply returns null in those cases.
   */
  // TODO: rate limiting on /auth/resend-verification.
  async issueVerificationToken(emailInput: string) {
    const email = emailInput.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return null;

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email));

    if (!user || !user.passwordHash || user.emailVerifiedAt) {
      return null;
    }

    const { token, hash } = generateVerificationToken();
    await this.db
      .update(users)
      .set({
        verificationTokenHash: hash,
        verificationTokenExpiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return { token, user };
  }

  /**
   * Generate + persist a password-reset token for an existing password-auth
   * user. Returns { token, user } so the caller can dispatch an email.
   * Returns null silently for unknown emails / Google-only accounts — the
   * caller should still surface a generic "email sent" message to avoid
   * enumeration.
   */
  // TODO: rate limiting on /auth/forgot-password.
  async issuePasswordResetToken(emailInput: string) {
    const email = emailInput.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return null;

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email));

    // Only password-auth users get a reset link. Google-only accounts need
    // to sign in via Google; sending a reset email would be misleading.
    if (!user || !user.passwordHash) return null;

    const { token, hash } = generateVerificationToken();
    await this.db
      .update(users)
      .set({
        passwordResetTokenHash: hash,
        passwordResetExpiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return { token, user };
  }

  /**
   * Consume a password-reset token and set the new password. The token
   * is single-use: successful reset clears both the hash and expiry so a
   * leaked link can't be replayed.
   */
  async resetPassword(rawToken: string, newPassword: string) {
    if (!rawToken) {
      throw new BadRequestException('Missing reset token');
    }
    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    const providedHash = hashVerificationToken(rawToken);

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.passwordResetTokenHash, providedHash));

    if (!user || !user.passwordResetTokenHash) {
      throw new BadRequestException('Invalid or already-used reset link');
    }

    const a = Buffer.from(providedHash, 'hex');
    const b = Buffer.from(user.passwordResetTokenHash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new BadRequestException('Invalid or already-used reset link');
    }

    if (
      !user.passwordResetExpiresAt ||
      user.passwordResetExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException('Reset link has expired');
    }

    const passwordHash = await argon2.hash(newPassword);
    await this.db
      .update(users)
      .set({
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        // Invalidate any outstanding refresh tokens on password change.
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    await this.redis.del(`refresh:${user.id}`);

    return { id: user.id, email: user.email };
  }

  async setProfileType(userId: string, profileType: 'company' | 'personal') {
    if (profileType !== 'company' && profileType !== 'personal') {
      throw new BadRequestException('Invalid profile type');
    }
    const [updated] = await this.db
      .update(users)
      .set({ profileType, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) {
      throw new UnauthorizedException('User not found');
    }
    return updated;
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
      emailVerified: !!user.emailVerifiedAt,
      profileType: user.profileType as 'company' | 'personal' | null,
      onboardingCompleted: !!user.onboardingCompletedAt,
      canCreateProject,
    };
  }

  async processTeamInvitations(userId: string, email: string) {
    // Match invites case-insensitively — the invite row is stored lowercase,
    // but callers here pass whatever casing Google/JWT gave us.
    const normalized = email.trim().toLowerCase();
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
      })
      .where(
        and(
          eq(teamMembers.email, normalized),
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
