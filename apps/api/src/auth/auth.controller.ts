import {
  Controller,
  Get,
  Post,
  Request,
  Response,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service.js';
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

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
    await this.authService.processTeamInvitations(user.id, user.email);
    const tokens = await this.authService.generateTokens(
      user.id,
      user.email,
      user.isPaid,
    );

    res.cookie('access_token', tokens.accessToken, {
      ...COOKIE_OPTIONS,
      maxAge: 15 * 60 * 1000, // 15 minutes
    });
    res.cookie('refresh_token', tokens.refreshToken, {
      ...COOKIE_OPTIONS,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const cookies = req.cookies as Record<string, string> | undefined;
    const returnTo = cookies?.invite_return_to;
    res.clearCookie('invite_return_to', { path: '/' });

    if (returnTo && typeof returnTo === 'string' && returnTo.startsWith('/')) {
      res.redirect(`${frontendUrl}${returnTo}`);
    } else {
      res.redirect(frontendUrl);
    }
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

    res.cookie('access_token', tokens.accessToken, {
      ...COOKIE_OPTIONS,
      maxAge: 15 * 60 * 1000,
    });
    res.cookie('refresh_token', tokens.refreshToken, {
      ...COOKIE_OPTIONS,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ message: 'Tokens refreshed' });
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
}
