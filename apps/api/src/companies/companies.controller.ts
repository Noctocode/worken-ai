import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Patch,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { users } from '@worken/database/schema';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { CompaniesService } from './companies.service.js';

@Controller('companies')
export class CompaniesController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly companiesService: CompaniesService,
  ) {}

  /**
   * Single-tenant for now, so the FE always asks for `current` rather
   * than carrying an id around. Read access is open to any
   * authenticated user — the company name + contact email are not
   * sensitive and the Company tab is reachable by everyone.
   */
  @Get('current')
  getCurrent() {
    return this.companiesService.getCurrent();
  }

  @Patch('current')
  async update(
    @CurrentUser() caller: AuthenticatedUser,
    @Body()
    body: {
      name?: string;
      contactEmail?: string | null;
      monthlyBudgetCents?: number;
    },
  ) {
    await this.assertAdmin(caller.id);
    return this.companiesService.update(body);
  }

  /**
   * "Delete" really means "reset settings to defaults" — see the
   * companies.service.ts comment for why we don't drop the row.
   * Admin-gated to match the destructive intent of the Trash2 button
   * on the Company tab.
   */
  @Delete('current')
  async remove(@CurrentUser() caller: AuthenticatedUser) {
    await this.assertAdmin(caller.id);
    return this.companiesService.reset();
  }

  private async assertAdmin(callerId: string): Promise<void> {
    const [callerUser] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, callerId));
    if (!callerUser || callerUser.role !== 'admin') {
      throw new ForbiddenException('Only admins can edit company settings.');
    }
  }
}
