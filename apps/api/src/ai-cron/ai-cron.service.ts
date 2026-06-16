import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CronExpressionParser } from 'cron-parser';
import { and, desc, eq } from 'drizzle-orm';
import {
  scheduledPromptRuns,
  scheduledPrompts,
  teamMembers,
  teams,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';

/**
 * Fields a caller may set on a scheduled prompt. `teamId` is the canonical
 * scope field (null = personal); the FE model picker's "personal" | "<teamId>"
 * scope string is collapsed to null/teamId before it reaches here. This maps
 * 1:1 to ChatTransportService.resolve({ userId, modelIdentifier, teamId }) so
 * the runner needs no translation layer.
 */
export interface CreateScheduledPromptInput {
  name: string;
  prompt: string;
  modelIdentifier: string;
  teamId?: string | null;
  cronExpression: string;
  timezone?: string;
  useKnowledgeCore?: boolean;
  knowledgeFolderId?: string | null;
  useWebSearch?: boolean;
  deliverInApp?: boolean;
  deliverEmail?: boolean;
  emailRecipients?: string[];
  deliverWebhook?: boolean;
  webhookUrl?: string | null;
  isEnabled?: boolean;
}

export type UpdateScheduledPromptInput = Partial<CreateScheduledPromptInput>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class AiCronService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(userId: string) {
    return this.db
      .select()
      .from(scheduledPrompts)
      .where(eq(scheduledPrompts.ownerId, userId))
      .orderBy(desc(scheduledPrompts.updatedAt));
  }

  async get(id: string, userId: string) {
    const [row] = await this.db
      .select()
      .from(scheduledPrompts)
      .where(
        and(eq(scheduledPrompts.id, id), eq(scheduledPrompts.ownerId, userId)),
      );
    if (!row) throw new NotFoundException('Scheduled prompt not found.');
    return row;
  }

  async create(userId: string, input: CreateScheduledPromptInput) {
    const values = await this.buildValues(userId, input, true);
    const timezone = (input.timezone ?? 'UTC').trim() || 'UTC';
    // Precompute the first due time so the scanner (commit 5) can pick it up
    // without re-deriving it. Computed from now in the job's timezone.
    const nextRunAt = this.computeNextRun(input.cronExpression, timezone);

    // buildValues returns an untyped bag of validated fields; the required
    // columns (name/prompt/model/cron) are guaranteed present because
    // requireRequired=true throws otherwise. Assert the insert shape here.
    const insertValues = {
      ownerId: userId,
      ...values,
      timezone,
      nextRunAt,
    } as typeof scheduledPrompts.$inferInsert;

    const [row] = await this.db
      .insert(scheduledPrompts)
      .values(insertValues)
      .returning();
    return row;
  }

  async update(id: string, userId: string, input: UpdateScheduledPromptInput) {
    const existing = await this.get(id, userId);

    const patch = await this.buildValues(userId, input, false);
    const next: Record<string, unknown> = { ...patch, updatedAt: new Date() };

    // Recompute nextRunAt whenever the schedule changes — the stored value
    // must always reflect the current cron + timezone.
    const cronChanged = input.cronExpression !== undefined;
    const tzChanged = input.timezone !== undefined;
    if (cronChanged || tzChanged) {
      const cron = input.cronExpression ?? existing.cronExpression;
      const tz = tzChanged
        ? (input.timezone ?? 'UTC').trim() || 'UTC'
        : existing.timezone;
      next.timezone = tz;
      next.nextRunAt = this.computeNextRun(cron, tz);
    }

    const [row] = await this.db
      .update(scheduledPrompts)
      .set(next)
      .where(
        and(eq(scheduledPrompts.id, id), eq(scheduledPrompts.ownerId, userId)),
      )
      .returning();
    return row;
  }

  async remove(id: string, userId: string): Promise<void> {
    const deleted = await this.db
      .delete(scheduledPrompts)
      .where(
        and(eq(scheduledPrompts.id, id), eq(scheduledPrompts.ownerId, userId)),
      )
      .returning({ id: scheduledPrompts.id });
    if (deleted.length === 0) {
      throw new NotFoundException('Scheduled prompt not found.');
    }
  }

  async setEnabled(id: string, userId: string, isEnabled: boolean) {
    const existing = await this.get(id, userId);

    // Re-enabling a job whose nextRunAt is stale (in the past) would make the
    // scanner fire it immediately. Re-anchor to the next future occurrence so
    // a pause/resume doesn't trigger an unexpected catch-up run.
    const patch: Record<string, unknown> = {
      isEnabled,
      updatedAt: new Date(),
    };
    if (isEnabled) {
      patch.nextRunAt = this.computeNextRun(
        existing.cronExpression,
        existing.timezone,
      );
    }

    const [row] = await this.db
      .update(scheduledPrompts)
      .set(patch)
      .where(
        and(eq(scheduledPrompts.id, id), eq(scheduledPrompts.ownerId, userId)),
      )
      .returning();
    return row;
  }

  async listRuns(id: string, userId: string, limit = 50, offset = 0) {
    // Ownership is enforced via the parent prompt before reading its runs.
    await this.get(id, userId);
    return this.db
      .select()
      .from(scheduledPromptRuns)
      .where(eq(scheduledPromptRuns.scheduledPromptId, id))
      .orderBy(desc(scheduledPromptRuns.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200))
      .offset(Math.max(offset, 0));
  }

  /**
   * Validate + normalize the writable fields shared by create/update.
   * `requireRequired` is true on create (name/prompt/model/cron must be
   * present) and false on update (only validate what's provided).
   */
  private async buildValues(
    userId: string,
    input: UpdateScheduledPromptInput,
    requireRequired: boolean,
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};

    if (input.name !== undefined) {
      if (!input.name.trim()) {
        throw new BadRequestException('`name` cannot be empty.');
      }
      out.name = input.name.trim();
    } else if (requireRequired) {
      throw new BadRequestException('`name` is required.');
    }

    if (input.prompt !== undefined) {
      if (!input.prompt.trim()) {
        throw new BadRequestException('`prompt` cannot be empty.');
      }
      out.prompt = input.prompt;
    } else if (requireRequired) {
      throw new BadRequestException('`prompt` is required.');
    }

    if (input.modelIdentifier !== undefined) {
      if (!input.modelIdentifier.trim()) {
        throw new BadRequestException('`modelIdentifier` cannot be empty.');
      }
      out.modelIdentifier = input.modelIdentifier.trim();
    } else if (requireRequired) {
      throw new BadRequestException('`modelIdentifier` is required.');
    }

    if (input.cronExpression !== undefined) {
      out.cronExpression = this.normalizeCron(input.cronExpression);
    } else if (requireRequired) {
      throw new BadRequestException('`cronExpression` is required.');
    }

    if (input.timezone !== undefined) {
      this.assertValidTimezone(input.timezone);
    }

    if (input.teamId !== undefined) {
      if (input.teamId === null) {
        out.teamId = null;
      } else {
        await this.assertTeamAccess(userId, input.teamId);
        out.teamId = input.teamId;
      }
    }

    if (input.useKnowledgeCore !== undefined) {
      out.useKnowledgeCore = !!input.useKnowledgeCore;
    }
    if (input.knowledgeFolderId !== undefined) {
      out.knowledgeFolderId = input.knowledgeFolderId || null;
    }
    if (input.useWebSearch !== undefined) {
      out.useWebSearch = !!input.useWebSearch;
    }

    if (input.deliverInApp !== undefined) {
      out.deliverInApp = !!input.deliverInApp;
    }
    if (input.deliverEmail !== undefined) {
      out.deliverEmail = !!input.deliverEmail;
    }
    if (input.emailRecipients !== undefined) {
      out.emailRecipients = this.normalizeEmails(input.emailRecipients);
    }
    if (input.deliverWebhook !== undefined) {
      out.deliverWebhook = !!input.deliverWebhook;
    }
    if (input.webhookUrl !== undefined) {
      out.webhookUrl = input.webhookUrl
        ? this.normalizeWebhookUrl(input.webhookUrl)
        : null;
    }

    if (input.isEnabled !== undefined) {
      out.isEnabled = !!input.isEnabled;
    }

    return out;
  }

  /**
   * Reject malformed cron expressions and anything other than the standard
   * 5-field form. A 6-field expression (with seconds) is meaningless here —
   * the scanner only ticks once a minute — so we refuse it rather than
   * silently ignore the seconds field.
   */
  private normalizeCron(expr: string): string {
    const trimmed = (expr ?? '').trim().replace(/\s+/g, ' ');
    if (!trimmed) {
      throw new BadRequestException('`cronExpression` is required.');
    }
    if (trimmed.split(' ').length !== 5) {
      throw new BadRequestException(
        'Cron expression must have exactly 5 fields (minute hour day month weekday).',
      );
    }
    try {
      CronExpressionParser.parse(trimmed);
    } catch {
      throw new BadRequestException('Invalid cron expression.');
    }
    return trimmed;
  }

  /** Next future fire time for a cron expression in a given timezone. */
  computeNextRun(
    expr: string,
    timezone: string,
    from: Date = new Date(),
  ): Date {
    const interval = CronExpressionParser.parse(expr, {
      tz: timezone,
      currentDate: from,
    });
    return interval.next().toDate();
  }

  private assertValidTimezone(tz: string): void {
    try {
      // Throws RangeError for an unknown IANA zone.
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
    } catch {
      throw new BadRequestException(`Invalid timezone: ${tz}`);
    }
  }

  private normalizeEmails(recipients: unknown): string[] {
    if (!Array.isArray(recipients)) {
      throw new BadRequestException('`emailRecipients` must be an array.');
    }
    const cleaned = recipients
      .map((r) => (typeof r === 'string' ? r.trim().toLowerCase() : ''))
      .filter(Boolean);
    for (const addr of cleaned) {
      if (!EMAIL_RE.test(addr)) {
        throw new BadRequestException(`Invalid email address: ${addr}`);
      }
    }
    return Array.from(new Set(cleaned));
  }

  /**
   * Light URL validation only — must be a parseable https URL. The actual
   * SSRF defenses (resolve-once + private-range block + no redirects) live in
   * the delivery path (commit 7), enforced at request time.
   */
  private normalizeWebhookUrl(url: string): string {
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      throw new BadRequestException('`webhookUrl` is not a valid URL.');
    }
    if (parsed.protocol !== 'https:') {
      throw new BadRequestException('`webhookUrl` must use https.');
    }
    return parsed.toString();
  }

  /** Caller may scope a job to a team they own or are an accepted member of. */
  private async assertTeamAccess(
    userId: string,
    teamId: string,
  ): Promise<void> {
    const [owned] = await this.db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, teamId), eq(teams.ownerId, userId)))
      .limit(1);
    if (owned) return;

    const [member] = await this.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, userId),
          eq(teamMembers.status, 'accepted'),
        ),
      )
      .limit(1);
    if (!member) {
      throw new ForbiddenException('You do not have access to this team.');
    }
  }
}
