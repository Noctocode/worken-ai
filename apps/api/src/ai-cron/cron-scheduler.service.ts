import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, asc, count, eq, lte, notInArray } from 'drizzle-orm';
import { scheduledPromptRuns, scheduledPrompts } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { AiCronService } from './ai-cron.service.js';

// Per-tick claim ceiling — a backstop so one tick can't fan out unbounded
// work; surplus due jobs are picked up on the next minute.
const MAX_CLAIM_PER_TICK = 25;
// At most this many concurrent scheduled runs per owner, so one user can't
// monopolise the worker pool (or their team budget). Manual run-now is
// excluded (triggered_by = 'manual').
const MAX_CONCURRENT_RUNS_PER_OWNER = 3;
// A run whose heartbeat hasn't advanced in this long is considered dead.
const HEARTBEAT_STALE_MINUTES = 5;

@Injectable()
export class CronSchedulerService {
  private readonly logger = new Logger(CronSchedulerService.name);
  // Guards against overlapping ticks if a sweep ever runs past a minute.
  private ticking = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly aiCron: AiCronService,
  ) {}

  @Cron('* * * * *')
  async tick(): Promise<void> {
    if (this.ticking) {
      this.logger.warn('Previous AI Cron tick still running; skipping.');
      return;
    }
    this.ticking = true;
    try {
      await this.reapStaleRuns();
      const claimed = await this.claimDueJobs();
      if (claimed.length > 0) {
        // Execution is wired in commit 6 (runner). The claim has already
        // advanced next_run_at, so claimed jobs won't double-fire.
        this.logger.log(`Claimed ${claimed.length} due AI Cron job(s).`);
      }
    } catch (err) {
      this.logger.error(
        `AI Cron tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Phase 1 of the two-phase model: a short transaction that locks due rows
   * (FOR UPDATE SKIP LOCKED so parallel API instances never grab the same
   * job), advances next_run_at to the next future occurrence, and stamps
   * last_run_at. The lock releases on commit — the model call (commit 6)
   * runs outside any transaction so it never holds a row lock or DB
   * connection across a slow LLM request.
   */
  private async claimDueJobs(): Promise<{ id: string }[]> {
    const now = new Date();
    const capped = await this.cappedOwnerIds();
    const claimed: { id: string }[] = [];

    await this.db.transaction(async (tx) => {
      const conditions = [
        eq(scheduledPrompts.isEnabled, true),
        lte(scheduledPrompts.nextRunAt, now),
      ];
      // notInArray with an empty list is invalid SQL — only add the filter
      // when there are actually capped owners to exclude.
      if (capped.length > 0) {
        conditions.push(notInArray(scheduledPrompts.ownerId, capped));
      }

      const due = await tx
        .select({
          id: scheduledPrompts.id,
          cronExpression: scheduledPrompts.cronExpression,
          timezone: scheduledPrompts.timezone,
        })
        .from(scheduledPrompts)
        .where(and(...conditions))
        .orderBy(asc(scheduledPrompts.nextRunAt))
        .limit(MAX_CLAIM_PER_TICK)
        .for('update', { skipLocked: true });

      for (const job of due) {
        let nextRunAt: Date;
        try {
          nextRunAt = this.aiCron.computeNextRun(
            job.cronExpression,
            job.timezone,
            now,
          );
        } catch {
          // A stored expression that no longer parses would be re-claimed
          // every tick. Disable it so it stops churning; the owner can fix
          // and re-enable from the UI.
          this.logger.error(
            `Disabling AI Cron job ${job.id}: unparseable cron "${job.cronExpression}".`,
          );
          await tx
            .update(scheduledPrompts)
            .set({ isEnabled: false })
            .where(eq(scheduledPrompts.id, job.id));
          continue;
        }
        await tx
          .update(scheduledPrompts)
          .set({ lastRunAt: now, nextRunAt })
          .where(eq(scheduledPrompts.id, job.id));
        claimed.push({ id: job.id });
      }
    });

    return claimed;
  }

  /** Owners with at least the cap of in-flight scheduled runs. */
  private async cappedOwnerIds(): Promise<string[]> {
    const rows = await this.db
      .select({ ownerId: scheduledPrompts.ownerId, active: count() })
      .from(scheduledPromptRuns)
      .innerJoin(
        scheduledPrompts,
        eq(scheduledPromptRuns.scheduledPromptId, scheduledPrompts.id),
      )
      .where(
        and(
          eq(scheduledPromptRuns.status, 'running'),
          eq(scheduledPromptRuns.triggeredBy, 'schedule'),
        ),
      )
      .groupBy(scheduledPrompts.ownerId);
    return rows
      .filter((r) => Number(r.active) >= MAX_CONCURRENT_RUNS_PER_OWNER)
      .map((r) => r.ownerId);
  }

  /**
   * Mark runs stuck in `running` past the heartbeat window as failed. The
   * runner refreshes last_heartbeat_at while a model call is in flight
   * (commit 6); a stale heartbeat means the worker died mid-run. Heartbeat-
   * based rather than absolute-from-start so a legitimately long run (big
   * RAG context + web search + long output) isn't killed early.
   */
  private async reapStaleRuns(): Promise<void> {
    const cutoff = new Date(Date.now() - HEARTBEAT_STALE_MINUTES * 60_000);
    const reaped = await this.db
      .update(scheduledPromptRuns)
      .set({
        status: 'failed',
        errorMessage: 'Run timed out (worker heartbeat stale).',
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(scheduledPromptRuns.status, 'running'),
          lte(scheduledPromptRuns.lastHeartbeatAt, cutoff),
        ),
      )
      .returning({ id: scheduledPromptRuns.id });
    if (reaped.length > 0) {
      this.logger.warn(`Reaped ${reaped.length} stale AI Cron run(s).`);
    }
  }
}
