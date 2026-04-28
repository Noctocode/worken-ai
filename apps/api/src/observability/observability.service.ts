import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { observabilityEvents, teams, users } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';

/**
 * Derive a coarse provider label from an OpenRouter-style model id like
 * "openai/gpt-4o:free" → "openai". Falls back to "openrouter:other" so we
 * can still group unknown providers in the dashboard.
 */
export function providerFromModel(model: string | null | undefined): string {
  if (!model) return 'unknown';
  const slug = model.split('/')[0]?.toLowerCase();
  if (!slug) return 'unknown';
  const known = new Set([
    'openai',
    'anthropic',
    'google',
    'meta-llama',
    'mistralai',
    'cohere',
    'nvidia',
    'arcee-ai',
    'liquid',
    'stepfun',
    'baidu',
    'qwen',
    'deepseek',
  ]);
  return known.has(slug) ? slug : `openrouter:${slug}`;
}

const PROMPT_PREVIEW_MAX = 200;

function truncatePreview(prompt: string | null | undefined): string | null {
  if (!prompt) return null;
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  return trimmed.length <= PROMPT_PREVIEW_MAX
    ? trimmed
    : `${trimmed.slice(0, PROMPT_PREVIEW_MAX)}…`;
}

export interface RecordLLMCallInput {
  userId: string;
  teamId?: string | null;
  eventType:
    | 'arena_call'
    | 'evaluator_call'
    | 'arena_attachment_ocr'
    | 'guardrail_trigger'
    | string;
  model?: string | null;
  provider?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
  latencyMs?: number | null;
  success?: boolean;
  errorMessage?: string | null;
  prompt?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger(ObservabilityService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // ─── Aggregation queries (used by Phase 2 controller) ──────────────────

  async summary(from: Date, to: Date) {
    const [row] = await this.db
      .select({
        totalCost: sql<string>`coalesce(sum(${observabilityEvents.costUsd}), 0)::text`,
        totalTokens: sql<number>`coalesce(sum(${observabilityEvents.totalTokens}), 0)::int`,
        avgLatencyMs: sql<number>`coalesce(avg(${observabilityEvents.latencyMs}), 0)::int`,
        activeUsers: sql<number>`count(distinct ${observabilityEvents.userId})::int`,
        callCount: sql<number>`count(*)::int`,
      })
      .from(observabilityEvents)
      .where(
        and(
          gte(observabilityEvents.createdAt, from),
          lte(observabilityEvents.createdAt, to),
        ),
      );

    return {
      totalCost: Number(row?.totalCost ?? 0),
      totalTokens: Number(row?.totalTokens ?? 0),
      avgLatencyMs: Number(row?.avgLatencyMs ?? 0),
      activeUsers: Number(row?.activeUsers ?? 0),
      callCount: Number(row?.callCount ?? 0),
    };
  }

  async tokenUsageSeries(
    from: Date,
    to: Date,
    granularity: 'hour' | 'day' | 'week',
  ) {
    const bucketSql = sql.raw(`date_trunc('${granularity}', created_at)`);
    const rows = await this.db
      .select({
        bucket: sql<string>`${bucketSql}`,
        tokens: sql<number>`coalesce(sum(${observabilityEvents.totalTokens}), 0)::int`,
        cost: sql<string>`coalesce(sum(${observabilityEvents.costUsd}), 0)::text`,
        calls: sql<number>`count(*)::int`,
      })
      .from(observabilityEvents)
      .where(
        and(
          gte(observabilityEvents.createdAt, from),
          lte(observabilityEvents.createdAt, to),
        ),
      )
      .groupBy(bucketSql)
      .orderBy(bucketSql);

    return rows.map((r) => ({
      bucket: typeof r.bucket === 'string' ? r.bucket : new Date(r.bucket).toISOString(),
      tokens: Number(r.tokens ?? 0),
      cost: Number(r.cost ?? 0),
      calls: Number(r.calls ?? 0),
    }));
  }

  async costByProvider(from: Date, to: Date) {
    const rows = await this.db
      .select({
        provider: observabilityEvents.provider,
        cost: sql<string>`coalesce(sum(${observabilityEvents.costUsd}), 0)::text`,
        tokens: sql<number>`coalesce(sum(${observabilityEvents.totalTokens}), 0)::int`,
        calls: sql<number>`count(*)::int`,
      })
      .from(observabilityEvents)
      .where(
        and(
          gte(observabilityEvents.createdAt, from),
          lte(observabilityEvents.createdAt, to),
        ),
      )
      .groupBy(observabilityEvents.provider)
      .orderBy(sql`sum(${observabilityEvents.costUsd}) desc nulls last`);

    return rows.map((r) => ({
      provider: r.provider ?? 'unknown',
      cost: Number(r.cost ?? 0),
      tokens: Number(r.tokens ?? 0),
      calls: Number(r.calls ?? 0),
    }));
  }

  async listEvents(opts: {
    from: Date;
    to: Date;
    search?: string | null;
    userId?: string | null;
    teamId?: string | null;
    model?: string | null;
    eventType?: string | null;
    page: number;
    pageSize: number;
  }) {
    const conditions = [
      gte(observabilityEvents.createdAt, opts.from),
      lte(observabilityEvents.createdAt, opts.to),
    ];
    if (opts.userId) conditions.push(eq(observabilityEvents.userId, opts.userId));
    if (opts.teamId) conditions.push(eq(observabilityEvents.teamId, opts.teamId));
    if (opts.model) conditions.push(eq(observabilityEvents.model, opts.model));
    if (opts.eventType)
      conditions.push(eq(observabilityEvents.eventType, opts.eventType));
    if (opts.search?.trim()) {
      const needle = `%${opts.search.trim()}%`;
      const searchClause = or(
        ilike(observabilityEvents.promptPreview, needle),
        ilike(observabilityEvents.model, needle),
        ilike(users.name, needle),
        ilike(users.email, needle),
      );
      if (searchClause) conditions.push(searchClause);
    }

    const where = and(...conditions);
    const limit = Math.max(1, Math.min(opts.pageSize, 200));
    const offset = Math.max(0, (opts.page - 1) * limit);

    const [{ total }] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(observabilityEvents)
      .leftJoin(users, eq(users.id, observabilityEvents.userId))
      .where(where);

    const rows = await this.db
      .select({
        id: observabilityEvents.id,
        createdAt: observabilityEvents.createdAt,
        eventType: observabilityEvents.eventType,
        model: observabilityEvents.model,
        provider: observabilityEvents.provider,
        totalTokens: observabilityEvents.totalTokens,
        costUsd: sql<string>`${observabilityEvents.costUsd}::text`,
        latencyMs: observabilityEvents.latencyMs,
        success: observabilityEvents.success,
        errorMessage: observabilityEvents.errorMessage,
        promptPreview: observabilityEvents.promptPreview,
        userId: observabilityEvents.userId,
        userName: users.name,
        userEmail: users.email,
        teamId: observabilityEvents.teamId,
        teamName: teams.name,
      })
      .from(observabilityEvents)
      .leftJoin(users, eq(users.id, observabilityEvents.userId))
      .leftJoin(teams, eq(teams.id, observabilityEvents.teamId))
      .where(where)
      .orderBy(desc(observabilityEvents.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      total: Number(total ?? 0),
      page: opts.page,
      pageSize: limit,
      events: rows.map((r) => ({
        ...r,
        costUsd: r.costUsd === null ? null : Number(r.costUsd),
      })),
    };
  }

  async guardrailActivity(from: Date, to: Date) {
    const rows = await this.db
      .select({
        guardrailId: sql<string | null>`${observabilityEvents.metadata} ->> 'guardrailId'`,
        guardrailName: sql<string | null>`${observabilityEvents.metadata} ->> 'name'`,
        severity: sql<string | null>`${observabilityEvents.metadata} ->> 'severity'`,
        count: sql<number>`count(*)::int`,
        lastTriggeredAt: sql<Date>`max(${observabilityEvents.createdAt})`,
      })
      .from(observabilityEvents)
      .where(
        and(
          gte(observabilityEvents.createdAt, from),
          lte(observabilityEvents.createdAt, to),
          eq(observabilityEvents.eventType, 'guardrail_trigger'),
        ),
      )
      .groupBy(
        sql`${observabilityEvents.metadata} ->> 'guardrailId'`,
        sql`${observabilityEvents.metadata} ->> 'name'`,
        sql`${observabilityEvents.metadata} ->> 'severity'`,
      )
      .orderBy(sql`count(*) desc`);

    const totalTriggers = rows.reduce((sum, r) => sum + Number(r.count ?? 0), 0);
    return { totalTriggers, triggers: rows };
  }

  /**
   * Persist a single observability event. Errors are caught and logged so a
   * failing insert never breaks the user-facing request path.
   */
  async recordLLMCall(input: RecordLLMCallInput): Promise<void> {
    try {
      await this.db.insert(observabilityEvents).values({
        userId: input.userId,
        teamId: input.teamId ?? null,
        eventType: input.eventType,
        model: input.model ?? null,
        provider:
          input.provider ?? (input.model ? providerFromModel(input.model) : null),
        promptTokens: input.promptTokens ?? null,
        completionTokens: input.completionTokens ?? null,
        totalTokens: input.totalTokens ?? null,
        costUsd:
          input.costUsd !== undefined && input.costUsd !== null
            ? String(input.costUsd)
            : null,
        latencyMs: input.latencyMs ?? null,
        success: input.success ?? true,
        errorMessage: input.errorMessage ?? null,
        promptPreview: truncatePreview(input.prompt),
        metadata: input.metadata ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to record observability event for user ${input.userId} (${input.eventType}): ${msg}`,
      );
    }
  }
}
