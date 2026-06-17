import { promises as dnsPromises } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { Injectable, Logger } from '@nestjs/common';
import { scheduledPrompts } from '@worken/database/schema';
import { MailService } from '../mail/mail.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

export interface DeliveryPayload {
  runId: string;
  status: 'success' | 'failed';
  /** Scheduled runs always notify in-app; manual run-now respects the toggle
   *  (the caller already gets the result back synchronously). */
  triggeredBy: 'schedule' | 'manual';
  output: string;
  errorMessage?: string;
  citations?: { url: string; title?: string }[];
}

type ScheduledPrompt = typeof scheduledPrompts.$inferSelect;

// Webhook request budget. Kept tight — a webhook receiver should ack fast.
const WEBHOOK_TIMEOUT_MS = 10_000;
const WEBHOOK_MAX_RESPONSE_BYTES = 64 * 1024;
// In-app notification stores the full run output so the bell popover can show
// it (collapsed behind an accordion). Capped only to avoid pathologically huge
// notification rows; typical cron outputs are well under this.
const NOTIFICATION_BODY_MAX = 6000;

/**
 * Reject IPs that point back into our own infrastructure. Blocks the cloud
 * metadata endpoint (169.254.169.254), loopback, RFC1918 private ranges,
 * CGNAT, and the IPv6 equivalents — the core of SSRF defense for a
 * user-supplied webhook URL.
 */
function isBlockedAddress(ip: string): boolean {
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true; // this-host / 10/8 / loopback
    if (a === 169 && b === 254) return true; // link-local incl. metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  if (lower.startsWith('fe80')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 unique-local
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower); // IPv4-mapped
  if (mapped) return isBlockedAddress(mapped[1]);
  return true; // unknown shape → fail closed
}

/**
 * Delivers a finished run's output over the channels the job enabled. Each
 * channel reports its own status into the returned map (persisted on the run
 * row); a failure in one channel never aborts the others, and never throws —
 * delivery is best-effort relative to the run itself, which already succeeded.
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  async deliver(
    prompt: ScheduledPrompt,
    payload: DeliveryPayload,
  ): Promise<Record<string, string>> {
    const status: Record<string, string> = {};

    // A scheduled run ALWAYS produces an in-app notification (success or
    // failure) so the owner knows it ran, regardless of the deliverInApp
    // toggle. Manual run-now respects the toggle — the caller already gets
    // the result back synchronously.
    if (prompt.deliverInApp || payload.triggeredBy === 'schedule') {
      status.inApp = await this.deliverInApp(prompt, payload);
    }
    if (prompt.deliverEmail) {
      status.email = await this.deliverEmail(prompt, payload);
    }
    if (prompt.deliverWebhook && prompt.webhookUrl) {
      status.webhook = await this.deliverWebhook(prompt, payload);
    }

    return status;
  }

  private async deliverInApp(
    prompt: ScheduledPrompt,
    payload: DeliveryPayload,
  ): Promise<string> {
    const succeeded = payload.status === 'success';
    const raw = succeeded
      ? payload.output
      : `Run failed: ${payload.errorMessage ?? 'unknown error'}`;
    const body =
      raw.length > NOTIFICATION_BODY_MAX
        ? `${raw.slice(0, NOTIFICATION_BODY_MAX)}…`
        : raw;
    const view = await this.notifications.create({
      userId: prompt.ownerId,
      type: 'ai_cron_run',
      title: succeeded
        ? `AI Cron: ${prompt.name}`
        : `AI Cron failed: ${prompt.name}`,
      body,
      data: {
        scheduledPromptId: prompt.id,
        runId: payload.runId,
        status: payload.status,
      },
    });
    // create() swallows its own errors and returns null on failure.
    return view ? 'sent' : 'failed';
  }

  private async deliverEmail(
    prompt: ScheduledPrompt,
    payload: DeliveryPayload,
  ): Promise<string> {
    const recipients = prompt.emailRecipients ?? [];
    if (recipients.length === 0) return 'skipped (no recipients)';

    const output =
      payload.status === 'success'
        ? payload.output
        : `Run failed: ${payload.errorMessage ?? 'unknown error'}`;

    let ok = 0;
    let failed = 0;
    for (const to of recipients) {
      try {
        await this.mail.sendCronRunResult({
          to,
          jobName: prompt.name,
          output,
        });
        ok++;
      } catch (err) {
        failed++;
        this.logger.error(
          `AI Cron email to ${to} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (failed === 0) return `sent (${ok})`;
    if (ok === 0) return 'failed';
    return `partial (${ok} sent, ${failed} failed)`;
  }

  private async deliverWebhook(
    prompt: ScheduledPrompt,
    payload: DeliveryPayload,
  ): Promise<string> {
    try {
      await this.postWebhook(prompt.webhookUrl as string, {
        jobName: prompt.name,
        scheduledPromptId: prompt.id,
        runId: payload.runId,
        status: payload.status,
        output: payload.output,
        error: payload.errorMessage ?? null,
        citations: payload.citations ?? [],
      });
      return 'sent';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI Cron webhook failed: ${message}`);
      return message.includes('blocked') ? 'blocked' : 'failed';
    }
  }

  /**
   * SSRF-hardened webhook POST. Resolves the hostname ONCE and connects to
   * that exact validated IP (the request's `lookup` returns the pinned
   * address rather than re-resolving), which closes the DNS-rebinding TOCTOU
   * window. https only, private/loopback/link-local addresses rejected,
   * redirects NOT followed (node https never auto-follows, and a 3xx is
   * treated as failure), bounded timeout + response size.
   */
  private async postWebhook(
    urlStr: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const url = new URL(urlStr);
    if (url.protocol !== 'https:') {
      throw new Error('Webhook URL must use https.');
    }

    // Resolve once + validate. Direct IP-literal hosts get validated too.
    const { address } = await dnsPromises.lookup(url.hostname);
    if (isBlockedAddress(address)) {
      throw new Error(`Webhook target resolves to a blocked address.`);
    }

    const data = JSON.stringify(payload);

    await new Promise<void>((resolve, reject) => {
      // Connect straight to the validated IP (no second DNS resolution, so the
      // host can't rebind to an internal address between the check and the
      // connect), while `servername` keeps TLS cert validation against the
      // real hostname and the Host header keeps virtual-host routing correct.
      const req = httpsRequest(
        {
          host: address,
          servername: url.hostname,
          port: url.port ? Number(url.port) : 443,
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(data),
            'user-agent': 'WorkenAI-Cron/1.0',
            host: url.host,
          },
          timeout: WEBHOOK_TIMEOUT_MS,
        },
        (res) => {
          const code = res.statusCode ?? 0;
          let received = 0;
          res.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (received > WEBHOOK_MAX_RESPONSE_BYTES) res.destroy();
          });
          res.on('end', () => {
            if (code >= 200 && code < 300) resolve();
            else reject(new Error(`Webhook returned status ${code}.`));
          });
          res.on('error', reject);
        },
      );
      req.on('timeout', () =>
        req.destroy(new Error('Webhook request timed out.')),
      );
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }
}
