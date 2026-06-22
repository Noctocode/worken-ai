import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { WORKENAI_LOGO_BASE64 } from './logo-asset.js';

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

interface AccountRemovedParams {
  to: string;
  name: string | null;
  byName: string;
  companyName: string | null;
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
      attachments: [this.logoAttachment()],
    });
  }

  async sendVerificationEmail({ to, name, token }: VerificationEmailParams) {
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
    // The Follow Us footer renders only when at least one social URL is
    // configured (LINKEDIN_URL / TWITTER_URL) so unconfigured envs don't
    // show empty/dead links.
    const html = `
      <div style="font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; background: #ffffff; padding: 30px 100px;">
        ${this.brandedHeader()}
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
        ${this.brandedFooter()}
      </div>
    `;

    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to,
      subject: 'Confirm your email address',
      html,
      attachments: [this.logoAttachment()],
    });
  }

  /**
   * Brand header — logo image at the asset's native 128×17 (full-logo.png).
   * The previous 106×29 forced a 3.66 ratio onto a 7.53-ratio image, which
   * stretched the wordmark vertically (the "distorted logo" bug). Rendered
   * dimensions must match the asset's real aspect ratio.
   */
  private brandedHeader(): string {
    // The logo is embedded as a CID attachment (see logoAttachment) rather
    // than a remote URL: a mail client can't load `${FRONTEND_URL}/full-logo
    // .png` when FRONTEND_URL is localhost, and remote images are blocked by
    // default in most clients. A CID image renders without either problem.
    return `
      <div style="height: 48px; margin-bottom: 30px;">
        <img src="cid:workenai-logo" alt="WorkenAI" width="128" height="17" style="display: block; border: 0; outline: none; text-decoration: none; height: 17px; width: 128px;" />
      </div>
    `;
  }

  /**
   * Inline logo attachment referenced by `cid:workenai-logo` in the header.
   * Bytes are inlined (logo-asset.ts) so it ships with the build and needs no
   * filesystem read or publicly reachable asset host.
   */
  private logoAttachment() {
    return {
      filename: 'full-logo.png',
      content: Buffer.from(WORKENAI_LOGO_BASE64, 'base64'),
      cid: 'workenai-logo',
      contentType: 'image/png',
    };
  }

  /**
   * Brand footer — "Follow Us" + social icons. Renders only when at least
   * one social URL env var is configured. Each icon is a plain Unicode
   * glyph wrapped in an anchor; SVG/IMG icons require a hosted asset
   * pipeline (Mailchimp-style) and email clients block remote SVGs
   * inconsistently anyway.
   */
  private brandedFooter(): string {
    const linkedin = this.config.get<string>('LINKEDIN_URL');
    const twitter = this.config.get<string>('TWITTER_URL');
    if (!linkedin && !twitter) return '';

    // Anchor styles are margin-free so a single link centers cleanly
    // (per-side margin shifted the lone link off-center). Multi-link
    // cases get a middle-dot separator inserted between siblings.
    const link = (href: string, label: string) =>
      `<a href="${href}" style="display: inline-block; color: #4E5969; text-decoration: none; font-size: 14px;">${label}</a>`;

    const linkParts: string[] = [];
    if (linkedin) linkParts.push(link(linkedin, 'LinkedIn'));
    if (twitter) linkParts.push(link(twitter, 'Twitter'));
    const separator =
      '<span style="display: inline-block; padding: 0 10px; color: #C9CDD4;">·</span>';
    const links = linkParts.join(separator);

    return `
      <div style="margin-top: 30px; text-align: center;">
        <p style="font-size: 12px; font-weight: 600; color: #86909C; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 8px;">Follow Us</p>
        <div>${links}</div>
      </div>
    `;
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
        ${this.brandedHeader()}
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
        ${this.brandedFooter()}
      </div>
    `;

    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to,
      subject: 'Reset your WorkenAI password',
      html,
      attachments: [this.logoAttachment()],
    });
  }

  async sendOrgInvitation({ to, inviterName, role }: OrgInvitationParams) {
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const signupUrl = `${frontendUrl}/register?email=${encodeURIComponent(to)}`;

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[dev] org invitation for ${to}: ${signupUrl}`);
    }

    const html = `
      <div style="font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; background: #ffffff; padding: 30px 100px;">
        ${this.brandedHeader()}
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
        ${this.brandedFooter()}
      </div>
    `;

    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to,
      subject: `${inviterName} invited you to join WorkenAI`,
      html,
      attachments: [this.logoAttachment()],
    });
  }

  /**
   * Final-state notification — sent AFTER the user row has been
   * deleted, so we can't link the recipient to anything inside the
   * workspace (they have no account to log into anymore). Plain
   * "your account was removed" copy + the actor's name for audit.
   */
  async sendAccountRemovedEmail({
    to,
    name,
    byName,
    companyName,
  }: AccountRemovedParams) {
    const greeting = name?.trim() ? `Hi ${escapeHtml(name)},` : 'Hi,';
    const orgCopy = companyName?.trim()
      ? `the <strong>${escapeHtml(companyName)}</strong> workspace on WorkenAI`
      : 'a WorkenAI workspace';

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[dev] account-removed mail to ${to}`);
    }

    const html = `
      <div style="font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; background: #ffffff; padding: 30px 100px;">
        ${this.brandedHeader()}
        <div style="background: #ffffff; border-radius: 30px; padding: 30px 60px; text-align: center;">
          <h1 style="font-size: 32px; font-weight: 700; color: #1D2129; margin: 0 0 30px; line-height: 1.3;">Your access has been removed</h1>
          <p style="font-size: 16px; font-weight: 400; color: #4E5969; margin: 0 0 16px; line-height: 1.6; text-align: left;">${greeting}</p>
          <p style="font-size: 16px; font-weight: 400; color: #4E5969; margin: 0 0 16px; line-height: 1.6; text-align: left;">
            <strong>${escapeHtml(byName)}</strong> removed your account from ${orgCopy}. Your projects, chats, and personal data on this workspace have been deleted.
          </p>
          <p style="font-size: 16px; font-weight: 400; color: #4E5969; margin: 0 0 30px; line-height: 1.6; text-align: left;">
            If this looks like a mistake, get in touch with ${escapeHtml(byName)} directly — we don't process restore requests via support.
          </p>
          <p style="font-size: 14px; font-weight: 400; color: #4E5969; margin: 0; line-height: 1.3;">Best,<br/>WorkenAI Team</p>
        </div>
        <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 24px;">
          This email was sent to ${escapeHtml(to)}.
        </p>
        ${this.brandedFooter()}
      </div>
    `;

    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to,
      subject: `Your WorkenAI account has been removed`,
      html,
      attachments: [this.logoAttachment()],
    });
  }

  /**
   * AI Cron run result. Plain, readable layout — the body is model output
   * (often markdown), so it's rendered in a monospace <pre> with preserved
   * whitespace rather than rich HTML. Sent once per recipient by the caller.
   */
  async sendCronRunResult({
    to,
    jobName,
    output,
  }: {
    to: string;
    jobName: string;
    output: string;
  }) {
    const html = `
      <div style="font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; background: #ffffff; padding: 30px 100px;">
        ${this.brandedHeader()}
        <div style="background: #ffffff; border-radius: 30px; padding: 30px 60px;">
          <h1 style="font-size: 24px; font-weight: 700; color: #1D2129; margin: 0 0 8px; line-height: 1.3;">${escapeHtml(jobName)}</h1>
          <p style="font-size: 14px; font-weight: 400; color: #86909C; margin: 0 0 24px; line-height: 1.3;">Scheduled AI run result</p>
          <pre style="white-space: pre-wrap; word-break: break-word; font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; line-height: 1.6; color: #1D2129; background: #F7F8FA; border: 1px solid #E5E6EB; border-radius: 12px; padding: 16px; margin: 0 0 24px;">${escapeHtml(output)}</pre>
          <p style="font-size: 14px; font-weight: 400; color: #4E5969; margin: 0; line-height: 1.3;">Best,<br/>WorkenAI Team</p>
        </div>
        ${this.brandedFooter()}
      </div>
    `;

    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to,
      subject: `AI Cron: ${jobName}`,
      html,
      attachments: [this.logoAttachment()],
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
      attachments: [this.logoAttachment()],
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
