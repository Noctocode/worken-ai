import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Query,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { users } from '@worken/database/schema';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { ObservabilityService } from './observability.service.js';

type RangeKey = '24h' | '7d' | '30d' | '90d';
type Granularity = 'hour' | 'day' | 'week';

const RANGE_TO_MS: Record<RangeKey, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

function parseRange(raw: string | undefined): { key: RangeKey; from: Date; to: Date } {
  const key = (raw ?? '7d') as RangeKey;
  if (!(key in RANGE_TO_MS)) {
    throw new BadRequestException(
      `Invalid range "${raw}". Allowed: 24h, 7d, 30d, 90d.`,
    );
  }
  const to = new Date();
  const from = new Date(to.getTime() - RANGE_TO_MS[key]);
  return { key, from, to };
}

function defaultGranularityForRange(key: RangeKey): Granularity {
  if (key === '24h') return 'hour';
  if (key === '90d') return 'week';
  return 'day';
}

function parseGranularity(
  raw: string | undefined,
  fallback: Granularity,
): Granularity {
  if (!raw) return fallback;
  if (raw === 'hour' || raw === 'day' || raw === 'week') return raw;
  throw new BadRequestException(
    `Invalid granularity "${raw}". Allowed: hour, day, week.`,
  );
}

@Controller('observability')
export class ObservabilityController {
  constructor(
    private readonly observabilityService: ObservabilityService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  /**
   * Admin-only guard. AuthenticatedUser doesn't carry role, so we look it up.
   * Mirrors the pattern in users.controller.ts (inviteUser).
   */
  private async assertAdmin(caller: AuthenticatedUser): Promise<void> {
    const [row] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, caller.id));
    if (!row || row.role !== 'admin') {
      throw new ForbiddenException(
        'Observability dashboard is admin-only.',
      );
    }
  }

  @Get('summary')
  async summary(
    @CurrentUser() caller: AuthenticatedUser,
    @Query('range') range?: string,
  ) {
    await this.assertAdmin(caller);
    const { key, from, to } = parseRange(range);
    const span = to.getTime() - from.getTime();
    const previousFrom = new Date(from.getTime() - span);
    const previousTo = new Date(from.getTime() - 1);
    const [current, previous] = await Promise.all([
      this.observabilityService.summary(from, to),
      this.observabilityService.summary(previousFrom, previousTo),
    ]);
    return { range: key, current, previous };
  }

  @Get('token-usage')
  async tokenUsage(
    @CurrentUser() caller: AuthenticatedUser,
    @Query('range') range?: string,
    @Query('granularity') granularityRaw?: string,
  ) {
    await this.assertAdmin(caller);
    const { key, from, to } = parseRange(range);
    const granularity = parseGranularity(
      granularityRaw,
      defaultGranularityForRange(key),
    );
    const series = await this.observabilityService.tokenUsageSeries(
      from,
      to,
      granularity,
    );
    return { range: key, granularity, series };
  }

  @Get('cost-by-provider')
  async costByProvider(
    @CurrentUser() caller: AuthenticatedUser,
    @Query('range') range?: string,
  ) {
    await this.assertAdmin(caller);
    const { key, from, to } = parseRange(range);
    const providers = await this.observabilityService.costByProvider(from, to);
    return { range: key, providers };
  }

  @Get('team-analytics')
  async teamAnalytics(
    @CurrentUser() caller: AuthenticatedUser,
    @Query('range') range?: string,
  ) {
    await this.assertAdmin(caller);
    const { key, from, to } = parseRange(range);
    const teams = await this.observabilityService.teamAnalytics(from, to);
    return { range: key, teams };
  }

  @Get('events')
  async events(
    @CurrentUser() caller: AuthenticatedUser,
    @Query('range') range?: string,
    @Query('search') search?: string,
    @Query('user') userId?: string,
    @Query('team') teamId?: string,
    @Query('model') model?: string,
    @Query('eventType') eventType?: string,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ) {
    await this.assertAdmin(caller);
    const { key, from, to } = parseRange(range);
    const page = Math.max(1, Number(pageRaw) || 1);
    const pageSize = Math.max(1, Math.min(Number(pageSizeRaw) || 50, 200));
    const result = await this.observabilityService.listEvents({
      from,
      to,
      search: search ?? null,
      userId: userId ?? null,
      teamId: teamId ?? null,
      model: model ?? null,
      eventType: eventType ?? null,
      page,
      pageSize,
    });
    return { range: key, ...result };
  }

  @Get('guardrail-activity')
  async guardrailActivity(
    @CurrentUser() caller: AuthenticatedUser,
    @Query('range') range?: string,
  ) {
    await this.assertAdmin(caller);
    const { key, from, to } = parseRange(range);
    const result = await this.observabilityService.guardrailActivity(from, to);
    return { range: key, ...result };
  }
}
