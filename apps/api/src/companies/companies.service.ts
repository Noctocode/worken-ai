import {
  BadRequestException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { companies, observabilityEvents } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';

export interface CompanyView {
  id: string;
  name: string;
  contactEmail: string | null;
  monthlyBudgetCents: number;
  spentCents: number;
  projectedCents: number;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class CompaniesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Single-tenant: return the oldest companies row, creating one with
   * empty defaults if the table is empty. The CompanyTab on the FE
   * always expects something to render, so the get path doubles as a
   * lazy seed — no migration data dance needed.
   */
  async getCurrent(): Promise<CompanyView> {
    const row = await this.fetchOrSeed();
    const usage = await this.computeUsage();
    return toView(row, usage);
  }

  async update(input: {
    name?: string;
    contactEmail?: string | null;
    monthlyBudgetCents?: number;
  }): Promise<CompanyView> {
    // Validate before any DB call — keeps the BadRequest path tight
    // and lets the unit spec assert against a DB-less stub.
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (!trimmed) {
        throw new BadRequestException('Company name cannot be empty.');
      }
      updates.name = trimmed;
    }

    if (input.contactEmail !== undefined) {
      const raw = input.contactEmail?.trim() ?? '';
      if (raw.length === 0) {
        updates.contactEmail = null;
      } else {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
          throw new BadRequestException('Invalid contact email.');
        }
        updates.contactEmail = raw;
      }
    }

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
    await this.db.update(companies).set(updates).where(eq(companies.id, current.id));
    return this.getCurrent();
  }

  /**
   * Reset the singleton row in place rather than dropping it. A drop
   * + recreate would lose `createdAt` and inflate audit churn — admins
   * who hit Trash in the UI usually mean "wipe my settings", not
   * "destroy the workspace".
   */
  async reset(): Promise<CompanyView> {
    const current = await this.fetchOrSeed();
    await this.db
      .update(companies)
      .set({
        name: '',
        contactEmail: null,
        monthlyBudgetCents: 0,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, current.id));
    return this.getCurrent();
  }

  private async fetchOrSeed() {
    const [existing] = await this.db
      .select()
      .from(companies)
      .orderBy(asc(companies.createdAt))
      .limit(1);
    if (existing) return existing;

    const [created] = await this.db.insert(companies).values({}).returning();
    return created;
  }

  /**
   * Org-wide spend for the current calendar month, plus a linear
   * projection to month-end. Same shape teams.service.ts uses for its
   * per-team card so the FE can render an identical Spent / Projected
   * row without bespoke math.
   */
  private async computeUsage(): Promise<{
    spentCents: number;
    projectedCents: number;
  }> {
    const startOfMonth = sql`date_trunc('month', now())`;
    const [agg] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${observabilityEvents.costUsd}), 0)`,
      })
      .from(observabilityEvents)
      .where(
        and(
          eq(observabilityEvents.success, true),
          gte(observabilityEvents.createdAt, startOfMonth),
        ),
      );
    const spentUsd = agg ? parseFloat(agg.total) : 0;
    const spentCents = Math.round(spentUsd * 100);

    const now = new Date();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getDate();
    const projectedCents =
      dayOfMonth > 0
        ? Math.round((spentCents / dayOfMonth) * daysInMonth)
        : spentCents;

    return { spentCents, projectedCents };
  }
}

function toView(
  row: typeof companies.$inferSelect,
  usage: { spentCents: number; projectedCents: number },
): CompanyView {
  return {
    id: row.id,
    name: row.name,
    contactEmail: row.contactEmail,
    monthlyBudgetCents: row.monthlyBudgetCents,
    spentCents: usage.spentCents,
    projectedCents: usage.projectedCents,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
