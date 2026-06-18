import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { skillRunSteps, skillRuns, skills } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { ChatTransportService } from '../integrations/chat-transport.service.js';
import { ToolCallingService } from '../integrations/tool-calling.service.js';
import type { AgentLoopEvent } from '../integrations/agent-tools.types.js';
import { OpenRouterCatalogService } from '../models/openrouter-catalog.service.js';
import { ObservabilityService } from '../observability/observability.service.js';
import {
  ToolRegistryService,
  type StoredArtifact,
} from './tool-registry.service.js';
import { SKILL_SANDBOX, type SkillSandboxRuntime } from './skill-sandbox.js';

/** Hard cap on model↔tool round-trips per run (fail-closed). */
const MAX_ITERATIONS = 8;
const PREVIEW_CHARS = 1000;
/**
 * Hard per-run cost ceiling (USD). The real cost-blowup guard for a multi-call
 * agent loop: checked before each upstream call against the run's accumulated
 * spend, so a runaway loop fails closed instead of billing without bound. The
 * v1 path bills the user's own Anthropic (BYOK) key, so this protects the
 * user directly. Tune via config later (Phase F).
 */
const MAX_RUN_COST_USD = 1.0;
/** Rough chars→tokens divisor for the informational pre-run estimate. */
const CHARS_PER_TOKEN = 4;
/** Completion tokens assumed per round for the pre-run estimate. */
const ESTIMATE_COMPLETION_TOKENS = 1024;

export interface RunSkillParams {
  userId: string;
  skillId: string;
  modelIdentifier: string;
  /** What the user asked the skill to do; defaults to a generic kick-off. */
  userMessage?: string;
  conversationId?: string | null;
  projectId?: string | null;
  signal?: AbortSignal;
}

/** Events streamed out of a run: the agent-loop events plus run lifecycle. */
export type SkillRunEvent =
  | AgentLoopEvent
  | { type: 'run_started'; runId: string }
  | { type: 'cost_estimate'; estimatedUsd: number | null }
  | {
      type: 'artifact';
      id: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
    }
  | {
      type: 'run_done';
      runId: string;
      status: 'done' | 'failed' | 'cancelled';
      /** Rolled-up cost of the run's upstream calls (USD). */
      costUsd: number;
    };

function preview(s: string): string {
  return s.length > PREVIEW_CHARS ? s.slice(0, PREVIEW_CHARS) : s;
}

/**
 * Runs one executable skill (Option #3, 3a — agent loop, no sandbox). Ties
 * together the skill definition, the vetted ToolRegistry, and the
 * Anthropic-gated ToolCallingService, while persisting skill_runs +
 * skill_run_steps and streaming {@link SkillRunEvent}s to the caller.
 *
 * v1 scope: the caller runs an executable skill they OWN, and the skill's own
 * scripts are NOT executed yet (Phase D) — they're passed to the model as
 * reference while it works via the vetted tools. One active run per user.
 */
@Injectable()
export class SkillExecutionService {
  private readonly logger = new Logger(SkillExecutionService.name);
  /** Active run per user → its AbortController. Doubles as the one-run-per-user
   *  guard (a user is "running" iff they have an entry) and the handle the
   *  cancel endpoint aborts. */
  private readonly aborters = new Map<string, AbortController>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly toolCalling: ToolCallingService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly transport: ChatTransportService,
    private readonly observability: ObservabilityService,
    private readonly catalog: OpenRouterCatalogService,
    @Inject(SKILL_SANDBOX) private readonly sandbox: SkillSandboxRuntime,
  ) {}

  /** Build the system prompt: skill instructions + scripts + tool note. When
   *  scripts are executable (`canRunScripts`), they're presented as runnable
   *  via run_script rather than as read-only reference. */
  private buildSystem(
    skill: typeof skills.$inferSelect,
    canRunScripts: boolean,
  ): string {
    const parts = [skill.instructions];
    const scripts = skill.scripts ?? [];
    if (scripts.length > 0) {
      const rendered = scripts
        .map(
          (s) =>
            `### ${s.name} (${s.language})${s.entrypoint ? ' [entrypoint]' : ''}\n\`\`\`${s.language}\n${s.content}\n\`\`\``,
        )
        .join('\n\n');
      parts.push(
        canRunScripts
          ? `\n\n## Scripts\nThese are the skill's scripts. Run one with the run_script tool (by name, or omit the name for the entrypoint) to execute it in a sandbox and capture its output + any files it produces.\n\n${rendered}`
          : `\n\n## Reference scripts\nThese are the skill's scripts. They are NOT executed in this version — use them only to reason about how to complete the task.\n\n${rendered}`,
      );
    }
    parts.push(
      canRunScripts
        ? `\n\n## Tools\nUse kc_search and read_attached_file to gather what you need from the user's Knowledge Core, run_script to execute the skill's scripts, then produce the final answer.`
        : `\n\n## Tools\nUse kc_search and read_attached_file to gather what you need from the user's Knowledge Core, then produce the final answer.`,
    );
    return parts.join('');
  }

  async *run(params: RunSkillParams): AsyncIterable<SkillRunEvent> {
    const { userId, skillId, modelIdentifier } = params;

    if (this.aborters.has(userId)) {
      throw new ConflictException(
        'A skill is already running. Wait for it to finish or cancel it first.',
      );
    }

    // Owner-scoped load + validation (v1: run your own executable skill).
    const [skill] = await this.db
      .select()
      .from(skills)
      .where(eq(skills.id, skillId));
    if (!skill || skill.userId !== userId) {
      throw new NotFoundException('Skill not found.');
    }
    if (skill.source !== 'executable') {
      throw new BadRequestException('This skill is not executable.');
    }

    // Own AbortController so an explicit cancel (different request) can stop
    // this run; also tripped by client disconnect via the passed-in signal.
    const ac = new AbortController();
    if (params.signal) {
      if (params.signal.aborted) ac.abort();
      else
        params.signal.addEventListener('abort', () => ac.abort(), {
          once: true,
        });
    }
    this.aborters.set(userId, ac);
    const [run] = await this.db
      .insert(skillRuns)
      .values({
        skillId,
        userId,
        conversationId: params.conversationId ?? null,
        status: 'running',
      })
      .returning({ id: skillRuns.id });
    const runId = run.id;
    yield { type: 'run_started', runId };

    // Scripts run only when a real sandbox is configured (else they stay
    // reference-only, the Phase-B behavior).
    const canRunScripts =
      this.sandbox.isAvailable() && (skill.scripts?.length ?? 0) > 0;
    // Artifacts produced by run_script, collected as they're persisted and
    // streamed to the client as `artifact` events.
    const producedArtifacts: StoredArtifact[] = [];
    let emittedArtifacts = 0;
    const { tools, dispatch } = this.toolRegistry.build({
      userId,
      runId,
      scripts: skill.scripts ?? [],
      onArtifacts: (a) => producedArtifacts.push(...a),
      signal: ac.signal,
    });
    const callInputs = new Map<string, unknown>();
    let stepIndex = 0;
    // Spend accumulated across the run's upstream calls. Read by onBeforeCall
    // (the cost-ceiling gate) and persisted as the run's rolled-up cost.
    let accumulatedCost = 0;
    let finalStatus: 'done' | 'failed' | 'cancelled' = 'done';
    let errorMessage: string | null = null;

    try {
      const system = this.buildSystem(skill, canRunScripts);
      const userMessage = params.userMessage?.trim() || 'Run this skill.';

      // Resolve the route once for per-call budget gating; reused every round.
      const transport = await this.transport.resolve({
        userId,
        modelIdentifier,
        projectId: params.projectId ?? null,
      });

      // Informational pre-run estimate (one round, rough) for the FE / caller.
      const estPromptTokens = Math.ceil(
        (system.length + userMessage.length) / CHARS_PER_TOKEN,
      );
      const estimatedUsd = await this.catalog.estimateCost(
        modelIdentifier,
        estPromptTokens,
        ESTIMATE_COMPLETION_TOKENS,
      );
      yield { type: 'cost_estimate', estimatedUsd };

      // Re-gated before EVERY upstream call (Phase C): managed-budget approval
      // plus the hard per-run cost ceiling. Throwing fails the loop closed so a
      // runaway / over-budget run never makes the next call.
      const onBeforeCall = async (): Promise<void> => {
        // No-op for the v1 BYOK-Anthropic route (returns early for non-
        // OpenRouter sources); wired so managed routes re-gate correctly later.
        await this.transport.assertManagedBudgetApproved(transport, userId, {
          projectId: params.projectId ?? null,
        });
        if (accumulatedCost >= MAX_RUN_COST_USD) {
          throw new Error(
            `Skill run stopped: per-run cost ceiling of $${MAX_RUN_COST_USD.toFixed(
              2,
            )} reached.`,
          );
        }
      };

      for await (const ev of this.toolCalling.streamWithTools({
        userId,
        modelIdentifier,
        projectId: params.projectId,
        system,
        messages: [{ role: 'user', content: userMessage }],
        tools,
        dispatch,
        maxIterations: MAX_ITERATIONS,
        signal: ac.signal,
        onBeforeCall,
      })) {
        if (ev.type === 'tool_call') callInputs.set(ev.id, ev.input);
        if (ev.type === 'tool_result') {
          await this.db.insert(skillRunSteps).values({
            runId,
            stepIndex: stepIndex++,
            stepType: 'tool',
            tool: ev.name,
            inputPreview: preview(
              JSON.stringify(callInputs.get(ev.id) ?? null),
            ),
            outputPreview: preview(ev.output),
            success: !ev.isError,
          });
        }
        if (ev.type === 'usage') {
          // One observability event + one llm step per upstream call, tagged
          // with the run id (turnId) so the multi-call turn rolls up.
          const costDelta = await this.catalog.estimateCost(
            modelIdentifier,
            ev.promptTokens,
            ev.completionTokens,
          );
          if (costDelta != null) accumulatedCost += costDelta;
          await this.observability.recordLLMCall({
            userId,
            eventType: 'skill_run_call',
            model: modelIdentifier,
            promptTokens: ev.promptTokens,
            completionTokens: ev.completionTokens,
            totalTokens: ev.totalTokens,
            costUsd: costDelta,
            success: true,
            turnId: runId,
            metadata: { skillId, runId },
          });
          await this.db.insert(skillRunSteps).values({
            runId,
            stepIndex: stepIndex++,
            stepType: 'llm',
            model: modelIdentifier,
            promptTokens: ev.promptTokens,
            completionTokens: ev.completionTokens,
            totalTokens: ev.totalTokens,
            costUsd: costDelta != null ? String(costDelta) : null,
            success: true,
          });
        }
        if (ev.type === 'error') {
          finalStatus = 'failed';
          errorMessage = ev.message;
        }
        if (ev.type === 'done' && ev.stopReason === 'aborted') {
          finalStatus = 'cancelled';
        }
        yield ev;
        // Flush any artifacts run_script persisted during this event's
        // dispatch (e.g. on the tool_result of a run_script call).
        while (emittedArtifacts < producedArtifacts.length) {
          const a = producedArtifacts[emittedArtifacts++];
          yield {
            type: 'artifact',
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
          };
        }
      }
    } catch (err) {
      finalStatus = 'failed';
      errorMessage = err instanceof Error ? err.message : String(err);
      yield { type: 'error', message: errorMessage };
    } finally {
      this.aborters.delete(userId);
      await this.db
        .update(skillRuns)
        .set({
          status: finalStatus,
          error: errorMessage,
          costUsd: String(accumulatedCost),
          finishedAt: new Date(),
        })
        .where(eq(skillRuns.id, runId));
    }

    yield {
      type: 'run_done',
      runId,
      status: finalStatus,
      costUsd: accumulatedCost,
    };
  }

  /** Abort the caller's in-flight run, if any. Returns whether one was
   *  running. The run loop observes the signal and finalizes the row as
   *  'cancelled'. */
  cancel(userId: string): boolean {
    const ac = this.aborters.get(userId);
    if (!ac) return false;
    ac.abort();
    return true;
  }

  /** The caller's recent runs (newest first), for the run-history UI. */
  async listRuns(userId: string) {
    return this.db
      .select({
        id: skillRuns.id,
        skillId: skillRuns.skillId,
        status: skillRuns.status,
        error: skillRuns.error,
        startedAt: skillRuns.startedAt,
        finishedAt: skillRuns.finishedAt,
      })
      .from(skillRuns)
      .where(eq(skillRuns.userId, userId))
      .orderBy(desc(skillRuns.startedAt))
      .limit(50);
  }

  /** One run + its ordered steps (owner-only). */
  async getRun(userId: string, runId: string) {
    const [run] = await this.db
      .select()
      .from(skillRuns)
      .where(and(eq(skillRuns.id, runId), eq(skillRuns.userId, userId)));
    if (!run) throw new NotFoundException('Run not found.');
    const steps = await this.db
      .select()
      .from(skillRunSteps)
      .where(eq(skillRunSteps.runId, runId))
      .orderBy(skillRunSteps.stepIndex);
    return { ...run, steps };
  }
}
