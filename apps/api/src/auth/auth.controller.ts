import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Request,
  Response,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service.js';
import { TeamsService } from '../teams/teams.service.js';
import { MailService } from '../mail/mail.service.js';
import { Public } from './public.decorator.js';
import { CurrentUser } from './current-user.decorator.js';
import type { AuthenticatedUser, GoogleProfile } from './types.js';
import type { Request as Req, Response as Res } from 'express';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

function setSessionCookies(
  res: Res,
  tokens: { accessToken: string; refreshToken: string },
) {
  res.cookie('access_token', tokens.accessToken, {
    ...COOKIE_OPTIONS,
    maxAge: 15 * 60 * 1000,
  });
  res.cookie('refresh_token', tokens.refreshToken, {
    ...COOKIE_OPTIONS,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly teamsService: TeamsService,
    private readonly mailService: MailService,
  ) {}

  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleLogin() {
    // Passport redirects to Google
  }

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(
    @Request() req: Req & { user: GoogleProfile },
    @Response() res: Res,
  ) {
    const user = await this.authService.validateOrCreateUser(req.user);
    // Team-invite acceptance is explicit via the /invite page, not a
    // silent login sweep — otherwise we'd accept invites behind the
    // user's back.
    const tokens = await this.authService.generateTokens(
      user.id,
      user.email,
    );

    setSessionCookies(res, tokens);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const cookies = req.cookies as Record<string, string> | undefined;
    const returnTo = cookies?.invite_return_to;
    res.clearCookie('invite_return_to', { path: '/' });

    // Direct-redirect to /setup-profile when the account hasn't
    // finished onboarding. Without this, the FE landed on `/`,
    // rendered the dashboard chrome for a few hundred ms while
    // /auth/me resolved, and only then fired the
    // OnboardingGuard.replace — a visible flash of unauthorized UI.
    // The FE guard still does the same check as a safety net (cookie
    // restore, manual /-typing, etc.).
    const target = !user.onboardingCompletedAt
      ? '/setup-profile'
      : returnTo && typeof returnTo === 'string' && returnTo.startsWith('/')
        ? returnTo
        : '/';
    res.redirect(`${frontendUrl}${target}`);
  }

  @Public()
  @Post('refresh')
  async refresh(@Request() req: Req, @Response() res: Res) {
    const cookies = req.cookies as Record<string, string> | undefined;
    const refreshToken = cookies?.refresh_token;
    if (!refreshToken) {
      res.status(401).json({ message: 'No refresh token' });
      return;
    }

    const tokens = await this.authService.refreshAccessToken(refreshToken);

    setSessionCookies(res, tokens);

    res.json({ message: 'Tokens refreshed' });
  }

  @Public()
  @Post('signup')
  async signup(
    @Body()
    body: {
      email?: string;
      password?: string;
      name?: string;
      token?: string;
    },
    @Response() res: Res,
  ) {
    if (!body?.email || !body?.password || !body?.name) {
      throw new BadRequestException('Email, password, and name are required');
    }
    const email = body.email.trim().toLowerCase();

    // Defense-in-depth: if signing up via an invite, the submitted email must
    // match the invite's email. The /register UI disables the field when it
    // has ?email=, so this rejects tampering.
    if (body.token) {
      const invite = await this.teamsService.getInviteByToken(body.token);
      if (invite.email.toLowerCase() !== email) {
        throw new BadRequestException(
          'Please sign up using the email address the invitation was sent to',
        );
      }
    }

    const { user, verificationToken } = await this.authService.signupWithPassword({
      email,
      password: body.password,
      name: body.name,
      // Invite token is proof of email ownership — skip the verification email.
      autoVerify: !!body.token,
    });

    if (body.token) {
      // Invited flow: accept the invite, issue a session right away, return
      // the same { user } shape as before.
      try {
        await this.teamsService.acceptInviteByToken(
          body.token,
          user.id,
          user.email,
        );
      } catch {
        // Best-effort: user is created, sweep below still catches siblings.
      }
      await this.authService.processTeamInvitations(user.id, user.email);

      const tokens = await this.authService.generateTokens(
        user.id,
        user.email,
      );
      setSessionCookies(res, tokens);

      res.json({
        verified: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture,
        },
      });
      return;
    }

    // Standalone signup: send the verification email and return without a
    // session. Frontend will redirect to /check-email. If mail delivery
    // fails we still 200 — the user can resend from /check-email.
    if (verificationToken) {
      try {
        await this.mailService.sendVerificationEmail({
          to: user.email,
          name: user.name ?? 'there',
          token: verificationToken,
        });
      } catch (err) {
        console.error('Failed to send verification email:', err);
      }
    }

    res.json({
      verified: false,
      email: user.email,
      message: 'Verification email sent. Please check your inbox.',
    });
  }

  @Public()
  @Get('verify')
  async verifyEmail(
    @Query('token') token: string,
    @Response() res: Res,
  ) {
    const frontendUrl =
      process.env.FRONTEND_URL || 'http://localhost:3000';

    try {
      const user = await this.authService.verifyEmailToken(token);
      // Email proved — auto-login and send them to the profile-type picker.
      // If they've already picked a profile type (rare: they clicked an old
      // link after finishing setup), the frontend guard will pass them
      // straight through to the dashboard.
      const tokens = await this.authService.generateTokens(
        user.id,
        user.email,
      );
      setSessionCookies(res, tokens);
      res.redirect(`${frontendUrl}/setup-profile`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message.toLowerCase() : '';
      const code = message.includes('expired')
        ? 'expired'
        : message.includes('used') || message.includes('invalid')
          ? 'invalid'
          : 'invalid';
      res.redirect(`${frontendUrl}/login?verify_error=${code}`);
    }
  }

  @Public()
  @Post('resend-verification')
  async resendVerification(
    @Body() body: { email?: string },
  ) {
    if (body?.email) {
      const result = await this.authService.issueVerificationToken(body.email);
      if (result) {
        try {
          await this.mailService.sendVerificationEmail({
            to: result.user.email,
            name: result.user.name ?? 'there',
            token: result.token,
          });
        } catch (err) {
          console.error('Failed to send verification email:', err);
        }
      }
    }
    // Always 200 — don't leak whether the account exists.
    return {
      message:
        "If that account exists and isn't verified, we've sent a new link.",
    };
  }

  @Public()
  @Post('forgot-password')
  async forgotPassword(@Body() body: { email?: string }) {
    if (body?.email) {
      const result = await this.authService.issuePasswordResetToken(body.email);
      if (result) {
        try {
          await this.mailService.sendPasswordResetEmail({
            to: result.user.email,
            name: result.user.name ?? 'there',
            token: result.token,
          });
        } catch (err) {
          console.error('Failed to send password reset email:', err);
        }
      }
    }
    // Always 200 — don't leak whether the account exists.
    return {
      message:
        "If that account exists, we've sent a password reset link.",
    };
  }

  @Public()
  @Post('reset-password')
  async resetPassword(
    @Body() body: { token?: string; password?: string },
  ) {
    if (!body?.token || !body?.password) {
      throw new BadRequestException('token and password are required');
    }
    await this.authService.resetPassword(body.token, body.password);
    return { success: true };
  }

  @Public()
  @Post('login')
  async login(
    @Body() body: { email?: string; password?: string },
    @Response() res: Res,
  ) {
    if (!body?.email || !body?.password) {
      throw new BadRequestException('Email and password are required');
    }

    const user = await this.authService.loginWithPassword(
      body.email,
      body.password,
    );

    // Team-invite acceptance happens explicitly via /invite?token=…
    // once the user reaches the page — don't sweep pending invites on
    // login, or the invite token gets consumed before the page loads.

    const tokens = await this.authService.generateTokens(
      user.id,
      user.email,
    );
    setSessionCookies(res, tokens);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
      },
    });
  }

  @Post('logout')
  async logout(@CurrentUser() user: AuthenticatedUser, @Response() res: Res) {
    await this.authService.logout(user.id);

    res.clearCookie('access_token', COOKIE_OPTIONS);
    res.clearCookie('refresh_token', COOKIE_OPTIONS);

    res.json({ message: 'Logged out' });
  }

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getUser(user.id);
  }

  @Post('profile-type')
  async setProfileType(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { profileType?: 'company' | 'personal' },
  ) {
    if (!body?.profileType) {
      throw new BadRequestException('profileType is required');
    }
    await this.authService.setProfileType(user.id, body.profileType);
    return this.authService.getUser(user.id);
  }
}
