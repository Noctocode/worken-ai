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
}
