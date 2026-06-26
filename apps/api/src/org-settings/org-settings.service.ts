import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { companies, observabilityEvents, users } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';

export interface OrgSettingsView {
  id: string;
  /**
   * Monthly company-wide budget target (cents). Tri-state, mirrors
   * `team_members.monthlyCapCents`:
   *   - null → no target set (gate silent-passes, UI shows "No target")
   *   - 0    → tenant-wide chat suspended (gate 402s with ORG_SUSPENDED)
   *   - >0   → enforced when tenant spend + estimate >= cap
   */
  monthlyBudgetCents: number | null;
  /** Org-wide default for the web-search capability. Teams can override
   *  per-team; projects switch it on within whatever is allowed here. */
  webSearchEnabled: boolean;
  /** Org-wide toggle for the ARSO environmental-data AI tools. Keyless;
   *  off by default — an admin opts in. Company-wide (no team/project
   *  override). */
  arsoEnabled: boolean;
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
   * Per-tenant getter. The budget lives on the caller's `companies`
   * row (UUID-keyed) — replacing the legacy deployment-wide
   * `org_settings` singleton that leaked the cap across tenants
   * (admin in tenant A flipping $0 used to suspend tenant B's chat).
   *
   * Personal-profile / mid-onboarding callers have no tenant; we
   * return a synthetic "no target set" view so the Company tab can
   * render without surfacing a 404 in the personal-profile UX.
   */
  async getCurrent(callerId: string): Promise<OrgSettingsView> {
    const company = await this.fetchTenantCompany(callerId);
    if (!company) return emptyView();
    return toView(company);
  }

  async update(
    input: {
      /** undefined → leave the saved value alone; null → clear the
       *  target back to "no enforcement"; integer → save (0 suspends,
       *  >0 enforces). */
      monthlyBudgetCents?: number | null;
      /** Org-wide web-search capability toggle. undefined → leave as-is. */
      webSearchEnabled?: boolean;
      /** Org-wide ARSO tools toggle. undefined → leave as-is. */
      arsoEnabled?: boolean;
    },
    /** Caller user id. Resolves the tenant whose budget is being
     *  updated and feeds the threshold / announcement notification
     *  fanout. */
    callerUserId: string,
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
    if (input.webSearchEnabled !== undefined) {
      if (typeof input.webSearchEnabled !== 'boolean') {
        throw new BadRequestException('`webSearchEnabled` must be a boolean.');
      }
      updates.webSearchEnabled = input.webSearchEnabled;
    }
    if (input.arsoEnabled !== undefined) {
      if (typeof input.arsoEnabled !== 'boolean') {
        throw new BadRequestException('`arsoEnabled` must be a boolean.');
      }
      updates.arsoEnabled = input.arsoEnabled;
    }

    const current = await this.fetchTenantCompany(callerUserId);
    if (!current) {
      // No tenant means no company budget to set. Surfaces as a 404
      // on the controller; the FE only shows the Company tab for
      // company-profile users so this branch is largely defensive.
      throw new NotFoundException(
        'No company tenant linked to this account — finish onboarding first.',
      );
    }

    await this.db
      .update(companies)
      .set(updates)
      .where(eq(companies.id, current.id));

    // Proactive threshold check after admin-driven budget change.
    // Same shape as TeamsService.updateBudget — fires when the new
    // cap puts existing month-to-date spend at or past 80% / 100%
    // without anyone making a fresh chat call.
    if (
      typeof input.monthlyBudgetCents === 'number' &&
      input.monthlyBudgetCents > 0
    ) {
      await this.checkAndAlertOrgBudgetThresholds(
        callerUserId,
        input.monthlyBudgetCents,
      );
    }

    // Info-only 'budget_changed' announcement for every tenant admin
    // minus the caller. Independent of threshold alerts — every
    // actual value change drops a row so the inbox doubles as a
    // lightweight audit trail. Skipped when the cap is left alone or
    // rewritten to the same value.
    if (
      input.monthlyBudgetCents !== undefined &&
      input.monthlyBudgetCents !== current.monthlyBudgetCents
    ) {
      await this.announceOrgBudgetChange(
        callerUserId,
        current.monthlyBudgetCents,
        input.monthlyBudgetCents,
      );
    }

    return this.getCurrent(callerUserId);
  }

  /**
   * Fan out a 'budget_changed' info-only notification for the
   * tenant budget. Recipients = every admin in the caller's tenant
   * INCLUDING the caller, so the actor also gets a row in their own
   * inbox as an audit trail of changes they made. Best-effort,
   * never throws.
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
      this.logger.error(`Failed to announce org-budget change: ${msg}`);
    }
  }

  /**
   * Mirror of TeamsService.checkAndAlertTeamBudgetThresholds for the
   * tenant-wide budget: re-evaluates current-month spend against
   * the freshly-saved cap and enqueues notifs for every tenant
   * admin if the new cap puts the tenant past a threshold. Best-
   * effort — a notification failure must not abort the budget save.
   *
   * Spend aggregation is scoped to `event.userId IN (tenant users)`
   * — the legacy implementation summed every event in the deployment
   * which would double-count cross-tenant traffic in a multi-tenant
   * install. Aligned with the same companyId-keyed scope used in
   * observability.service.
   */
  private async checkAndAlertOrgBudgetThresholds(
    callerUserId: string,
    budgetCents: number,
  ): Promise<void> {
    try {
      const tenantUserIds = await this.resolveTenantUserIds(callerUserId);
      if (tenantUserIds.length === 0) return;
      const [agg] = await this.db
        .select({
          total: sql<string>`coalesce(sum(${observabilityEvents.costUsd}), 0)`,
        })
        .from(observabilityEvents)
        .where(
          and(
            eq(observabilityEvents.success, true),
            gte(observabilityEvents.createdAt, sql`date_trunc('month', now())`),
            inArray(observabilityEvents.userId, tenantUserIds),
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

  /**
   * Resolve the caller's tenant companies row. Returns null when the
   * caller is personal-profile / mid-onboarding (no `companyId`).
   * Centralised so getCurrent + update share the same null-handling.
   */
  private async fetchTenantCompany(callerId: string) {
    const [caller] = await this.db
      .select({ companyId: users.companyId })
      .from(users)
      .where(eq(users.id, callerId));
    if (!caller?.companyId) return null;
    const [row] = await this.db
      .select()
      .from(companies)
      .where(eq(companies.id, caller.companyId));
    return row ?? null;
  }

  /**
   * Mirror of ObservabilityService.resolveTenantUserIds — kept
   * private here to avoid a module cross-dep, identical semantics.
   */
  private async resolveTenantUserIds(callerId: string): Promise<string[]> {
    const [caller] = await this.db
      .select({
        profileType: users.profileType,
        companyId: users.companyId,
      })
      .from(users)
      .where(eq(users.id, callerId));
    if (!caller) return [];
    if (caller.profileType === 'company' && caller.companyId) {
      const tenantMembers = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.companyId, caller.companyId));
      return tenantMembers.map((m) => m.id);
    }
    return [callerId];
  }
}

function toView(row: typeof companies.$inferSelect): OrgSettingsView {
  return {
    id: row.id,
    monthlyBudgetCents: row.monthlyBudgetCents,
    webSearchEnabled: row.webSearchEnabled,
    arsoEnabled: row.arsoEnabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function emptyView(): OrgSettingsView {
  // Synthetic shape for personal-profile / pre-tenant callers — the
  // FE renders "No target set" without needing to special-case the
  // 404 path. Stamped with epoch so JSON.stringify doesn't blow up
  // on null timestamps.
  const epoch = new Date(0).toISOString();
  return {
    id: '',
    monthlyBudgetCents: null,
    webSearchEnabled: false,
    arsoEnabled: false,
    createdAt: epoch,
    updatedAt: epoch,
  };
}
