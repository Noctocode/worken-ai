import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, asc, count, eq, lte, notInArray } from 'drizzle-orm';
import { scheduledPromptRuns, scheduledPrompts } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { AiCronService } from './ai-cron.service.js';
import { CronRunnerService } from './cron-runner.service.js';

type ScheduledPrompt = typeof scheduledPrompts.$inferSelect;

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
    private readonly runner: CronRunnerService,
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
        this.logger.log(`Dispatching ${claimed.length} due AI Cron run(s).`);
        // Phase 2: execute outside the claim transaction, fire-and-forget so
        // the tick returns promptly (the `ticking` guard only protects the
        // short claim/reap, not the long model calls). The runner is fully
        // self-terminating — it records success/failure on the run row — so
        // a rejection here would only ever be an unexpected bug; log it.
        for (const job of claimed) {
          void this.runner
            .execute(job.prompt, job.runId, 'schedule')
            .catch((err) => {
              this.logger.error(
                `AI Cron run ${job.runId} dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            });
        }
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
  private async claimDueJobs(): Promise<
    { prompt: ScheduledPrompt; runId: string }[]
  > {
    const now = new Date();
    const activeByOwner = await this.activeRunsByOwner();
    const capped = [...activeByOwner.entries()]
      .filter(([, n]) => n >= MAX_CONCURRENT_RUNS_PER_OWNER)
      .map(([id]) => id);
    // In-tick counter so an owner with many due jobs can't blow past the cap
    // within a single tick (the SQL filter above only excludes owners already
    // at the cap before this tick started).
    const inTick = new Map<string, number>();
    const claimed: { prompt: ScheduledPrompt; runId: string }[] = [];

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
        .select()
        .from(scheduledPrompts)
        .where(and(...conditions))
        .orderBy(asc(scheduledPrompts.nextRunAt))
        .limit(MAX_CLAIM_PER_TICK)
        .for('update', { skipLocked: true });

      for (const job of due) {
        // Enforce the per-owner cap within this tick too.
        const inFlight =
          (activeByOwner.get(job.ownerId) ?? 0) +
          (inTick.get(job.ownerId) ?? 0);
        if (inFlight >= MAX_CONCURRENT_RUNS_PER_OWNER) continue;

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

        // Advance the schedule (the dedup) and open the run row as `running`
        // with a fresh heartbeat — so even before the runner picks it up the
        // reaper can account for it — all inside the claim transaction.
        await tx
          .update(scheduledPrompts)
          .set({ lastRunAt: now, nextRunAt })
          .where(eq(scheduledPrompts.id, job.id));

        const [run] = await tx
          .insert(scheduledPromptRuns)
          .values({
            scheduledPromptId: job.id,
            status: 'running',
            triggeredBy: 'schedule',
            startedAt: now,
            lastHeartbeatAt: now,
          })
          .returning({ id: scheduledPromptRuns.id });

        claimed.push({ prompt: job, runId: run.id });
        inTick.set(job.ownerId, (inTick.get(job.ownerId) ?? 0) + 1);
      }
    });

    return claimed;
  }

  /** Count of in-flight scheduled runs per owner. */
  private async activeRunsByOwner(): Promise<Map<string, number>> {
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
    return new Map(rows.map((r) => [r.ownerId, Number(r.active)]));
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
