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
import { ToolCallingService } from '../integrations/tool-calling.service.js';
import type { AgentLoopEvent } from '../integrations/agent-tools.types.js';
import { ToolRegistryService } from './tool-registry.service.js';

/** Hard cap on model↔tool round-trips per run (fail-closed). */
const MAX_ITERATIONS = 8;
const PREVIEW_CHARS = 1000;

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
  | {
      type: 'run_done';
      runId: string;
      status: 'done' | 'failed' | 'cancelled';
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
  /** One in-flight run per user (mirrors the import activeJobs guard). */
  private readonly activeRuns = new Set<string>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly toolCalling: ToolCallingService,
    private readonly toolRegistry: ToolRegistryService,
  ) {}

  /** Build the system prompt: skill instructions + reference scripts + tool note. */
  private buildSystem(skill: typeof skills.$inferSelect): string {
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
        `\n\n## Reference scripts\nThese are the skill's scripts. They are NOT executed in this version — use them only to reason about how to complete the task.\n\n${rendered}`,
      );
    }
    parts.push(
      `\n\n## Tools\nUse kc_search and read_attached_file to gather what you need from the user's Knowledge Core, then produce the final answer.`,
    );
    return parts.join('');
  }

  async *run(params: RunSkillParams): AsyncIterable<SkillRunEvent> {
    const { userId, skillId, modelIdentifier } = params;

    if (this.activeRuns.has(userId)) {
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

    this.activeRuns.add(userId);
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

    const { tools, dispatch } = this.toolRegistry.build({ userId });
    const callInputs = new Map<string, unknown>();
    let stepIndex = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let finalStatus: 'done' | 'failed' | 'cancelled' = 'done';
    let errorMessage: string | null = null;

    try {
      for await (const ev of this.toolCalling.streamWithTools({
        userId,
        modelIdentifier,
        projectId: params.projectId,
        system: this.buildSystem(skill),
        messages: [
          {
            role: 'user',
            content: params.userMessage?.trim() || 'Run this skill.',
          },
        ],
        tools,
        dispatch,
        maxIterations: MAX_ITERATIONS,
        signal: params.signal,
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
          promptTokens = ev.promptTokens;
          completionTokens = ev.completionTokens;
        }
        if (ev.type === 'error') {
          finalStatus = 'failed';
          errorMessage = ev.message;
        }
        if (ev.type === 'done' && ev.stopReason === 'aborted') {
          finalStatus = 'cancelled';
        }
        yield ev;
      }
    } catch (err) {
      finalStatus = 'failed';
      errorMessage = err instanceof Error ? err.message : String(err);
      yield { type: 'error', message: errorMessage };
    } finally {
      this.activeRuns.delete(userId);
      // Record the single LLM step's token usage as one summary step so the
      // trace + future billing (Phase C) have it; cost is backfilled later.
      await this.db.insert(skillRunSteps).values({
        runId,
        stepIndex: stepIndex++,
        stepType: 'llm',
        model: modelIdentifier,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        success: finalStatus !== 'failed',
      });
      await this.db
        .update(skillRuns)
        .set({
          status: finalStatus,
          error: errorMessage,
          finishedAt: new Date(),
        })
        .where(eq(skillRuns.id, runId));
    }

    yield { type: 'run_done', runId, status: finalStatus };
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
