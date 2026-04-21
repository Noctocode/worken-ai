import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

interface TeamInvitationParams {
  to: string;
  teamName: string;
  inviterName: string;
  role: string;
  token: string;
}

interface VerificationEmailParams {
  to: string;
  name: string;
  token: string;
}

interface PasswordResetEmailParams {
  to: string;
  name: string;
  token: string;
}

interface TeamInvitationExistingParams {
  to: string;
  teamName: string;
  inviterName: string;
  role: string;
  token: string;
}

interface OrgInvitationParams {
  to: string;
  inviterName: string;
  role: string;
}

@Injectable()
export class MailService {
  private transporter: Transporter;

  constructor(private readonly config: ConfigService) {
    this.transporter = createTransport({
      host: this.config.get<string>('MAIL_HOST'),
      port: 587,
      secure: false,
      auth: {
        user: this.config.get<string>('MAIL_USER'),
        pass: this.config.get<string>('MAIL_PASSWORD'),
      },
    });
  }

  async sendTeamInvitation({
    to,
    teamName,
    inviterName,
    role,
    token,
  }: TeamInvitationParams) {
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const acceptUrl = `${frontendUrl}/invite?token=${token}`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="font-size: 24px; font-weight: 600; color: #0f172a; margin: 0;">WorkenAI</h1>
        </div>
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px;">
          <h2 style="font-size: 20px; font-weight: 600; color: #0f172a; margin: 0 0 16px;">You've been invited to a team</h2>
          <p style="font-size: 15px; color: #475569; line-height: 1.6; margin: 0 0 8px;">
            <strong>${inviterName}</strong> has invited you to join <strong>${teamName}</strong> as a <strong>${role}</strong> member.
          </p>
          <p style="font-size: 14px; color: #64748b; line-height: 1.6; margin: 0 0 24px;">
            Click the button below to accept the invitation and join the team.
          </p>
          <div style="text-align: center; margin-bottom: 24px;">
            <a href="${acceptUrl}" style="display: inline-block; background: #0f172a; color: #ffffff; font-size: 15px; font-weight: 500; text-decoration: none; padding: 12px 32px; border-radius: 8px;">
              Accept Invitation
            </a>
          </div>
          <p style="font-size: 12px; color: #94a3b8; line-height: 1.5; margin: 0;">
            If the button doesn't work, copy and paste this link into your browser:<br/>
            <a href="${acceptUrl}" style="color: #3b82f6; word-break: break-all;">${acceptUrl}</a>
          </p>
        </div>
        <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 24px;">
          This invitation was sent to ${to}. If you weren't expecting this, you can safely ignore it.
        </p>
      </div>
    `;

    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to,
      subject: `${inviterName} invited you to join ${teamName} on WorkenAI`,
      html,
    });
  }

  async sendVerificationEmail({ to, name, token }: VerificationEmailParams) {
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const apiUrl =
      this.config.get<string>('API_URL') || 'http://localhost:3001';
    const verifyUrl = `${apiUrl}/auth/verify?token=${encodeURIComponent(token)}`;
    const greetingName = (name || 'there').split(' ')[0];

    // Dev-mode affordance: without SMTP configured locally the verification
    // email silently no-ops. Logging the URL here lets a developer just
    // click it from the terminal. Never runs in production.
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[dev] verification URL for ${to}: ${verifyUrl}`);
    }

    // Matches Figma frame 4110-16154: 800px container, white bg, centered
    // inner card (30px padding, 30px radius), blue (#178ACA) CTA, IBM Plex
    // Sans type. Inlined styles because email clients don't run CSS files.
    const html = `
      <div style="font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; background: #ffffff; padding: 30px 100px;">
        <div style="display: flex; align-items: center; gap: 6px; height: 48px; margin-bottom: 30px;">
          <span style="font-size: 26px; font-weight: 700; color: #1D2129; letter-spacing: -0.01em;">WorkenAI</span>
        </div>
        <div style="background: #ffffff; border-radius: 30px; padding: 30px 60px; text-align: center;">
          <h1 style="font-size: 32px; font-weight: 700; color: #1D2129; margin: 0 0 30px; line-height: 1.3;">Hi ${escapeHtml(greetingName)},</h1>
          <p style="font-size: 23px; font-weight: 400; color: #1D2129; margin: 0 0 30px; line-height: 1.3;">Thanks for joining WorkenAI</p>
          <p style="font-size: 16px; font-weight: 400; color: #4E5969; margin: 0 0 30px; line-height: 1.3;">To complete your account setup, please confirm your email address by clicking the button below:</p>
          <div style="margin: 0 0 30px;">
            <a href="${verifyUrl}" style="display: inline-block; background: #178ACA; color: #ffffff; font-size: 16px; font-weight: 400; text-decoration: none; padding: 16px 24px; border-radius: 8px;">Confirm Email Address</a>
          </div>
          <p style="font-size: 16px; font-weight: 400; color: #4E5969; margin: 0 0 8px; line-height: 1.3;">Can't see the button? Copy and paste this link into your browser:</p>
          <p style="font-size: 16px; font-weight: 400; color: #86909C; margin: 0 0 30px; line-height: 1.3; word-break: break-all;">${verifyUrl}</p>
          <p style="font-size: 14px; font-weight: 400; color: #4E5969; margin: 0; line-height: 1.3;">Best,<br/>WorkenAI Team</p>
        </div>
      </div>
    `;

    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to,
      subject: 'Confirm your email address',
      html,
    });

    // Reference frontend URL so the import stays useful even when the
    // template later links back into app flows.
    void frontendUrl;
  }

  async sendPasswordResetEmail({ to, name, token }: PasswordResetEmailParams) {
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const greetingName = (name || 'there').split(' ')[0];

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[dev] password reset URL for ${to}: ${resetUrl}`);
    }

    const html = `
      <div style="font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; background: #ffffff; padding: 30px 100px;">
        <div style="display: flex; align-items: center; gap: 6px; height: 48px; margin-bottom: 30px;">
          <span style="font-size: 26px; font-weight: 700; color: #1D2129; letter-spacing: -0.01em;">WorkenAI</span>
        </div>
        <div style="background: #ffffff; border-radius: 30px; padding: 30px 60px; text-align: center;">
          <h1 style="font-size: 32px; font-weight: 700; color: #1D2129; margin: 0 0 30px; line-height: 1.3;">Hi ${escapeHtml(greetingName)},</h1>
          <p style="font-size: 23px; font-weight: 400; color: #1D2129; margin: 0 0 30px; line-height: 1.3;">Reset your WorkenAI password</p>
          <p style="font-size: 16px; font-weight: 400; color: #4E5969; margin: 0 0 30px; line-height: 1.3;">Click the button below to choose a new password. This link expires in 1 hour.</p>
          <div style="margin: 0 0 30px;">
            <a href="${resetUrl}" style="display: inline-block; background: #178ACA; color: #ffffff; font-size: 16px; font-weight: 400; text-decoration: none; padding: 16px 24px; border-radius: 8px;">Reset Password</a>
          </div>
          <p style="font-size: 16px; font-weight: 400; color: #4E5969; margin: 0 0 8px; line-height: 1.3;">Can't see the button? Copy and paste this link into your browser:</p>
          <p style="font-size: 16px; font-weight: 400; color: #86909C; margin: 0 0 30px; line-height: 1.3; word-break: break-all;">${resetUrl}</p>
          <p style="font-size: 14px; font-weight: 400; color: #4E5969; margin: 0 0 8px; line-height: 1.3;">If you didn't request this, you can safely ignore this email.</p>
          <p style="font-size: 14px; font-weight: 400; color: #4E5969; margin: 0; line-height: 1.3;">Best,<br/>WorkenAI Team</p>
        </div>
      </div>
    `;

    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to,
      subject: 'Reset your WorkenAI password',
      html,
    });
  }

  async sendOrgInvitation({
    to,
    inviterName,
    role,
  }: OrgInvitationParams) {
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const signupUrl = `${frontendUrl}/signup?email=${encodeURIComponent(to)}`;

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[dev] org invitation for ${to}: ${signupUrl}`);
    }

    const html = `
      <div style="font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; background: #ffffff; padding: 30px 100px;">
        <div style="display: flex; align-items: center; gap: 6px; height: 48px; margin-bottom: 30px;">
          <span style="font-size: 26px; font-weight: 700; color: #1D2129; letter-spacing: -0.01em;">WorkenAI</span>
        </div>
        <div style="background: #ffffff; border-radius: 30px; padding: 30px 60px; text-align: center;">
          <h1 style="font-size: 32px; font-weight: 700; color: #1D2129; margin: 0 0 30px; line-height: 1.3;">You've been invited to WorkenAI</h1>
          <p style="font-size: 16px; font-weight: 400; color: #4E5969; margin: 0 0 30px; line-height: 1.6;">
            <strong>${escapeHtml(inviterName)}</strong> has invited you to join their organization on WorkenAI as a <strong>${escapeHtml(role)}</strong> user.
          </p>
          <p style="font-size: 16px; font-weight: 400; color: #4E5969; margin: 0 0 30px; line-height: 1.6;">
            Create your account to get started.
          </p>
          <div style="margin: 0 0 30px;">
            <a href="${signupUrl}" style="display: inline-block; background: #178ACA; color: #ffffff; font-size: 16px; font-weight: 400; text-decoration: none; padding: 16px 24px; border-radius: 8px;">Create Account</a>
          </div>
          <p style="font-size: 16px; font-weight: 400; color: #4E5969; margin: 0 0 8px; line-height: 1.3;">Can't see the button? Copy and paste this link into your browser:</p>
          <p style="font-size: 16px; font-weight: 400; color: #86909C; margin: 0 0 30px; line-height: 1.3; word-break: break-all;">${signupUrl}</p>
          <p style="font-size: 14px; font-weight: 400; color: #4E5969; margin: 0; line-height: 1.3;">Best,<br/>WorkenAI Team</p>
        </div>
        <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 24px;">
          This invitation was sent to ${escapeHtml(to)}. If you weren't expecting this, you can safely ignore it.
        </p>
      </div>
    `;

    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to,
      subject: `${inviterName} invited you to join WorkenAI`,
      html,
    });
  }

  async sendTeamInvitationExisting({
    to,
    teamName,
    inviterName,
    role,
    token,
  }: TeamInvitationExistingParams) {
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const acceptUrl = `${frontendUrl}/invite?token=${token}`;

    // Same accept link as the standard invite, but copy is tuned for a
    // recipient who already has an account: "sign in to accept" rather
    // than "create your account".
    const html = `
      <div style="font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="font-size: 24px; font-weight: 600; color: #0f172a; margin: 0;">WorkenAI</h1>
        </div>
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px;">
          <h2 style="font-size: 20px; font-weight: 600; color: #0f172a; margin: 0 0 16px;">You've been invited to a team</h2>
          <p style="font-size: 15px; color: #475569; line-height: 1.6; margin: 0 0 8px;">
            <strong>${escapeHtml(inviterName)}</strong> invited you to join <strong>${escapeHtml(teamName)}</strong> as a <strong>${escapeHtml(role)}</strong> member.
          </p>
          <p style="font-size: 14px; color: #64748b; line-height: 1.6; margin: 0 0 24px;">
            Sign in with your existing WorkenAI account to accept the invitation.
          </p>
          <div style="text-align: center; margin-bottom: 24px;">
            <a href="${acceptUrl}" style="display: inline-block; background: #178ACA; color: #ffffff; font-size: 15px; font-weight: 500; text-decoration: none; padding: 12px 32px; border-radius: 8px;">
              Accept Invitation
            </a>
          </div>
          <p style="font-size: 12px; color: #94a3b8; line-height: 1.5; margin: 0;">
            If the button doesn't work, copy and paste this link into your browser:<br/>
            <a href="${acceptUrl}" style="color: #3b82f6; word-break: break-all;">${acceptUrl}</a>
          </p>
        </div>
        <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 24px;">
          This invitation was sent to ${to}. If you weren't expecting this, you can safely ignore it.
        </p>
      </div>
    `;

    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to,
      subject: `${inviterName} invited you to join ${teamName} on WorkenAI`,
      html,
    });
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
