import {
  Body,
  Controller,
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
import { OrgSettingsService } from './org-settings.service.js';

@Controller('org-settings')
export class OrgSettingsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly orgSettings: OrgSettingsService,
  ) {}

  /**
   * Read access is open to any authenticated user — the Company tab
   * needs the budget target to render its primary card and the value
   * isn't sensitive.
   */
  @Get()
  getCurrent() {
    return this.orgSettings.getCurrent();
  }

  @Patch()
  async update(
    @CurrentUser() caller: AuthenticatedUser,
    @Body() body: { monthlyBudgetCents?: number | null },
  ) {
    const [callerUser] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, caller.id));
    if (!callerUser || callerUser.role !== 'admin') {
      throw new ForbiddenException(
        'Only admins can change the company monthly budget.',
      );
    }
    return this.orgSettings.update(body, caller.id);
  }
}
