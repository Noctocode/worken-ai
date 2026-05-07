import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { orgSettings } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';

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
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Singleton getter: returns the oldest row, lazy-seeding an empty
   * one (monthlyBudgetCents=null) on first call. Cheaper than
   * running a migration for fresh deployments.
   */
  async getCurrent(): Promise<OrgSettingsView> {
    return toView(await this.fetchOrSeed());
  }

  async update(input: {
    /** undefined → leave the saved value alone; null → clear the
     *  target back to "no enforcement"; integer → save (0 suspends,
     *  >0 enforces). */
    monthlyBudgetCents?: number | null;
  }): Promise<OrgSettingsView> {
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
    return this.getCurrent();
  }

  private async fetchOrSeed() {
    const [existing] = await this.db
      .select()
      .from(orgSettings)
      .orderBy(asc(orgSettings.createdAt))
      .limit(1);
    if (existing) return existing;

    const [created] = await this.db.insert(orgSettings).values({}).returning();
    return created;
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
