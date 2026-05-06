import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { orgSettings } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';

export interface OrgSettingsView {
  id: string;
  /**
   * Monthly company-wide budget target (cents). 0 means "no target
   * set" — UI hides over-budget banners + Projected pill, future
   * chat-transport hard-cap gate (phase 2) will treat the same value
   * as "unlimited".
   */
  monthlyBudgetCents: number;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class OrgSettingsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Singleton getter: returns the oldest row, lazy-seeding an empty
   * one on first call. Cheaper than running a migration for fresh
   * deployments and matches the pattern used by the (defunct)
   * `companies` table earlier on the branch.
   */
  async getCurrent(): Promise<OrgSettingsView> {
    return toView(await this.fetchOrSeed());
  }

  async update(input: {
    monthlyBudgetCents?: number;
  }): Promise<OrgSettingsView> {
    // Validate before any DB call so the BadRequest path is tight and
    // testable from a stub.
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.monthlyBudgetCents !== undefined) {
      if (
        !Number.isInteger(input.monthlyBudgetCents) ||
        input.monthlyBudgetCents < 0
      ) {
        throw new BadRequestException(
          'Monthly budget must be a non-negative integer (cents).',
        );
      }
      updates.monthlyBudgetCents = input.monthlyBudgetCents;
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
