import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { observabilityEvents, orgSettings, users } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';

// Postgres advisory lock key for the singleton seed. Constant on
// purpose — every fetchOrSeed call grabs the same key, so concurrent
// first-time-GETs serialize through the lock and only the first
// transaction inserts the row. Held xact_lock so it auto-releases on
// commit / rollback.
const ORG_SETTINGS_SEED_LOCK = 974_184_372;

export interface OrgSettingsView {
  id: string;
  /**
   * Monthly company-wide budget target (cents). Tri-state, mirrors
   * `team_members.monthlyCapCents`:
   *   - null → no target set (gate silent-passes, UI shows "No target")
   *   - 0    → org-wide chat suspended (gate 402s with ORG_SUSPENDED)
   *   - >0   → enforced when org spend + estimate >= cap
   */
  monthlyBudgetCents: number | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class OrgSettingsService {
  private readonly logger = new Logger(OrgSettingsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Singleton getter: returns the oldest row, lazy-seeding an empty
   * one (monthlyBudgetCents=null) on first call. Cheaper than
   * running a migration for fresh deployments.
   */
  async getCurrent(): Promise<OrgSettingsView> {
    return toView(await this.fetchOrSeed());
  }

  async update(
    input: {
      /** undefined → leave the saved value alone; null → clear the
       *  target back to "no enforcement"; integer → save (0 suspends,
       *  >0 enforces). */
      monthlyBudgetCents?: number | null;
    },
    /** Caller user id, used to resolve company-scoped admin
     *  recipients for the budget-threshold notifications fired when
     *  a lowered cap suddenly puts the company past 80% / 100%. */
    callerUserId?: string,
  ): Promise<OrgSettingsView> {
    // Validate before any DB call so the BadRequest path stays tight
    // and testable from a stub.
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.monthlyBudgetCents !== undefined) {
      const next = input.monthlyBudgetCents;
      if (next !== null) {
        if (!Number.isInteger(next) || next < 0) {
          throw new BadRequestException(
            'Monthly budget must be null or a non-negative integer (cents).',
          );
        }
      }
      updates.monthlyBudgetCents = next;
    }

    const current = await this.fetchOrSeed();
    await this.db
      .update(orgSettings)
      .set(updates)
      .where(eq(orgSettings.id, current.id));

    // Proactive threshold check after admin-driven budget change.
    // Same shape as TeamsService.updateBudget — fires when the new
    // cap puts existing month-to-date spend at or past 80% / 100%
    // without anyone making a fresh chat call.
    if (
      callerUserId &&
      typeof input.monthlyBudgetCents === 'number' &&
      input.monthlyBudgetCents > 0
    ) {
      await this.checkAndAlertOrgBudgetThresholds(
        callerUserId,
        input.monthlyBudgetCents,
      );
    }

    // Info-only 'budget_changed' announcement for every company
    // admin minus the caller. Independent of threshold alerts —
    // every actual value change drops a row so the inbox doubles
    // as a lightweight audit trail. Skipped when the cap is left
    // alone or rewritten to the same value.
    if (
      callerUserId &&
      input.monthlyBudgetCents !== undefined &&
      input.monthlyBudgetCents !== current.monthlyBudgetCents
    ) {
      await this.announceOrgBudgetChange(
        callerUserId,
        current.monthlyBudgetCents,
        input.monthlyBudgetCents,
      );
    }

    return this.getCurrent();
  }

  /**
   * Fan out a 'budget_changed' info-only notification for the org
   * budget. Recipients = every company admin INCLUDING the caller,
   * so the actor also gets a row in their own inbox as an audit
   * trail of changes they made. Best-effort, never throws.
   *
   * `previousCents` / `nextCents` can be null when the cap toggles
   * between "no target" and a concrete value — formatted as
   * "(no target)" so the body still reads naturally.
   */
  private async announceOrgBudgetChange(
    callerUserId: string,
    previousCents: number | null,
    nextCents: number | null,
  ): Promise<void> {
    try {
      const recipients =
        await this.notifications.getOrgBudgetRecipients(callerUserId);
      if (recipients.length === 0) return;
      const [actor] = await this.db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, callerUserId))
        .limit(1);
      const actorName = actor?.name || actor?.email || 'An admin';
      const fmt = (c: number | null) =>
        c === null ? '(no target)' : `$${(c / 100).toFixed(2)}`;
      await Promise.allSettled(
        recipients.map((userId) =>
          this.notifications.create({
            userId,
            type: 'budget_changed',
            title: `Company monthly AI budget was changed`,
            body: `${fmt(previousCents)} → ${fmt(nextCents)}. Set by ${actorName}.`,
            data: {
              scope: 'org',
              previousCents,
              nextCents,
              actorId: callerUserId,
              actorName,
            },
          }),
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to announce org-budget change: ${msg}`,
      );
    }
  }

  /**
   * Mirror of TeamsService.checkAndAlertTeamBudgetThresholds for the
   * org-wide budget: re-evaluates current-month spend against the
   * freshly-saved cap and enqueues notifs for every company admin
   * if the new cap puts the org past a threshold. Best-effort —
   * a notification failure must not abort the budget save.
   */
  private async checkAndAlertOrgBudgetThresholds(
    callerUserId: string,
    budgetCents: number,
  ): Promise<void> {
    try {
      const [agg] = await this.db
        .select({
          total: sql<string>`coalesce(sum(${observabilityEvents.costUsd}), 0)`,
        })
        .from(observabilityEvents)
        .where(
          and(
            eq(observabilityEvents.success, true),
            gte(observabilityEvents.createdAt, sql`date_trunc('month', now())`),
          ),
        );
      const spentUsd = agg ? parseFloat(agg.total) : 0;
      const spentCents = Math.round(spentUsd * 100);
      const eightyPct = Math.floor(budgetCents * 0.8);

      const now = new Date();
      const periodKey = `${now.getUTCFullYear()}-${String(
        now.getUTCMonth() + 1,
      ).padStart(2, '0')}`;

      const recipients =
        await this.notifications.getOrgBudgetRecipients(callerUserId);
      const fanout = async (
        threshold: 80 | 100,
        title: string,
        body: string,
      ) => {
        await Promise.allSettled(
          recipients.map((userId) =>
            this.notifications.createIfNotExists({
              userId,
              type: 'budget_alert',
              title,
              body,
              data: {
                scope: 'org',
                threshold,
                budgetCents,
                spentCents,
                thresholdKey: `${periodKey}:org:${threshold}`,
              },
            }),
          ),
        );
      };

      if (spentCents >= budgetCents) {
        await fanout(
          100,
          `Your company is over its monthly AI budget`,
          `Spent ~$${(spentCents / 100).toFixed(2)} of $${(budgetCents / 100).toFixed(2)}. The new cap is already exceeded — chat is blocked until it's raised or next month resets.`,
        );
      } else if (spentCents >= eightyPct) {
        await fanout(
          80,
          `Your company has used 80% of its monthly AI budget`,
          `Spent ~$${(spentCents / 100).toFixed(2)} of $${(budgetCents / 100).toFixed(2)}.`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to evaluate org-budget threshold alerts: ${msg}`,
      );
    }
  }

  private async fetchOrSeed() {
    // Fast path: row already exists, common case after the first
    // call ever. No transaction overhead.
    const [existing] = await this.db
      .select()
      .from(orgSettings)
      .orderBy(asc(orgSettings.createdAt))
      .limit(1);
    if (existing) return existing;

    // Race-safe seed: two concurrent first-time GETs would otherwise
    // both see "no rows", both insert, and leave the table with
    // duplicates that getCurrent would then read inconsistently.
    // Wrap the seed in a transaction-scoped advisory lock so only
    // the first call inserts; the second blocks on the lock, then
    // re-reads the now-existing row. Schema is left lean (no
    // singleton constraint) — the lock is the cheaper guard since
    // contention only happens on first deploy.
    return await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${ORG_SETTINGS_SEED_LOCK})`,
      );
      const [recheck] = await tx
        .select()
        .from(orgSettings)
        .orderBy(asc(orgSettings.createdAt))
        .limit(1);
      if (recheck) return recheck;
      const [created] = await tx.insert(orgSettings).values({}).returning();
      return created;
    });
  }
}

function toView(row: typeof orgSettings.$inferSelect): OrgSettingsView {
  return {
    id: row.id,
    monthlyBudgetCents: row.monthlyBudgetCents,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
