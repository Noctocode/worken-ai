import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { scheduledPromptRuns, scheduledPrompts } from '@worken/database/schema';
import { ChatService } from '../chat/chat.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { ChatTransportService } from '../integrations/chat-transport.service.js';
import { resolveWebSearchCapability } from '../integrations/web-search-capability.resolver.js';
import { KnowledgeIngestionService } from '../knowledge-core/knowledge-ingestion.service.js';
import { ObservabilityService } from '../observability/observability.service.js';
import { DeliveryService, type DeliveryPayload } from './delivery.service.js';

type ScheduledPrompt = typeof scheduledPrompts.$inferSelect;

// Refresh the run heartbeat at this cadence while a model call is in flight,
// comfortably inside the scheduler's 5-min stale-heartbeat reaper window.
const HEARTBEAT_INTERVAL_MS = 60_000;
// How many knowledge-core chunks to retrieve as context when RAG is enabled.
const RAG_TOP_K = 5;

interface UsageTotals {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

/**
 * Executes a single scheduled-prompt run: builds the message + optional RAG
 * context, resolves the transport for the job's model/scope, runs a
 * (non-streaming, accumulated) completion, records usage to observability,
 * persists the run, and hands the output to delivery. Always terminal — on
 * any failure it records the error and marks the run failed.
 *
 * Runs outside any DB transaction (the scheduler's phase 1 already advanced
 * next_run_at and released its lock) so a slow LLM call never holds a lock or
 * connection.
 */
@Injectable()
export class CronRunnerService {
  private readonly logger = new Logger(CronRunnerService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly chat: ChatService,
    private readonly chatTransport: ChatTransportService,
    private readonly knowledgeIngestion: KnowledgeIngestionService,
    private readonly observability: ObservabilityService,
    private readonly delivery: DeliveryService,
  ) {}

  async execute(
    prompt: ScheduledPrompt,
    runId: string,
    triggeredBy: 'schedule' | 'manual' = 'schedule',
  ): Promise<void> {
    const startedAt = new Date();
    await this.db
      .update(scheduledPromptRuns)
      .set({ status: 'running', startedAt, lastHeartbeatAt: startedAt })
      .where(eq(scheduledPromptRuns.id, runId));

    // Keep the heartbeat fresh so the reaper doesn't kill a legitimately
    // long-running call. Cleared in finally.
    const heartbeat = setInterval(() => {
      void this.db
        .update(scheduledPromptRuns)
        .set({ lastHeartbeatAt: new Date() })
        .where(eq(scheduledPromptRuns.id, runId))
        .catch(() => {
          // A transient heartbeat write failure is non-fatal; the next tick
          // retries. Swallow so the interval never throws unhandled.
        });
    }, HEARTBEAT_INTERVAL_MS);

    // Declared outside the try so the catch can still tag observability with
    // whatever model/provider resolved (undefined if resolution itself fails).
    let transport:
      | Awaited<ReturnType<ChatTransportService['resolve']>>
      | undefined;

    try {
      transport = await this.chatTransport.resolve({
        userId: prompt.ownerId,
        modelIdentifier: prompt.modelIdentifier,
        teamId: prompt.teamId,
      });

      // 1. Optional knowledge-core RAG context.
      let context: string | undefined;
      if (prompt.useKnowledgeCore) {
        const chunks = await this.knowledgeIngestion.searchAccessibleChunks(
          prompt.ownerId,
          prompt.prompt,
          RAG_TOP_K,
        );
        if (chunks.length > 0) {
          context = chunks.map((c) => c.content).join('\n\n---\n\n');
        }
      }

      // 2. Web search: same three-factor gate as the chat path — the job
      //    must request it, the route must be OpenRouter (the web plugin is
      //    OpenRouter-only), and the org/team must permit it.
      const webSearch =
        prompt.useWebSearch &&
        transport.source === 'openrouter' &&
        (await resolveWebSearchCapability(
          this.db,
          prompt.ownerId,
          prompt.teamId,
        ));

      // 3. Run the completion, accumulating the streamed deltas into one
      //    output string (the schedule has no live consumer).
      let output = '';
      let usage: UsageTotals | undefined;
      let citations: { url: string; title?: string }[] | undefined;
      let streamError: string | undefined;

      for await (const ev of this.chat.sendMessageStream(
        [{ role: 'user' as const, content: prompt.prompt }],
        transport.model,
        false, // no reasoning channel needed for a stored result
        context,
        transport.apiKey,
        transport.baseURL,
        transport.kind,
        {
          webSearch,
          azureEndpoint: transport.azureEndpoint,
          azureApiVersion: transport.azureApiVersion,
        },
      )) {
        if (ev.type === 'content') output += ev.delta;
        else if (ev.type === 'usage') usage = ev;
        else if (ev.type === 'citations') citations = ev.citations;
        else if (ev.type === 'error') streamError = ev.message;
      }

      const latencyMs = Date.now() - startedAt.getTime();
      if (streamError) throw new Error(streamError);

      await this.observability.recordLLMCall({
        userId: prompt.ownerId,
        teamId: prompt.teamId,
        eventType: 'ai_cron_run',
        model: transport.model,
        provider: transport.provider,
        promptTokens: usage?.promptTokens ?? null,
        completionTokens: usage?.completionTokens ?? null,
        totalTokens: usage?.totalTokens ?? null,
        costUsd: usage?.costUsd ?? null,
        latencyMs,
        success: true,
        prompt: prompt.prompt,
        metadata: { scheduledPromptId: prompt.id, runId },
      });

      await this.db
        .update(scheduledPromptRuns)
        .set({
          status: 'success',
          output,
          finishedAt: new Date(),
          model: transport.model,
          provider: transport.provider,
          promptTokens: usage?.promptTokens ?? null,
          completionTokens: usage?.completionTokens ?? null,
          totalTokens: usage?.totalTokens ?? null,
          costUsd: usage?.costUsd != null ? String(usage.costUsd) : null,
          latencyMs,
        })
        .where(eq(scheduledPromptRuns.id, runId));

      await this.runDelivery(prompt, runId, {
        status: 'success',
        triggeredBy,
        output,
        citations,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI Cron run ${runId} failed: ${message}`);
      await this.observability
        .recordLLMCall({
          userId: prompt.ownerId,
          teamId: prompt.teamId,
          eventType: 'ai_cron_run',
          model: transport?.model ?? null,
          provider: transport?.provider ?? null,
          latencyMs: Date.now() - startedAt.getTime(),
          success: false,
          errorMessage: message,
          prompt: prompt.prompt,
          metadata: { scheduledPromptId: prompt.id, runId },
        })
        .catch(() => {
          // Observability is best-effort; never mask the original failure.
        });
      await this.db
        .update(scheduledPromptRuns)
        .set({
          status: 'failed',
          errorMessage: message,
          finishedAt: new Date(),
        })
        .where(eq(scheduledPromptRuns.id, runId));
      // Deliver the failure too — a scheduled run always notifies, so the
      // owner finds out it broke without having to open the run history.
      await this.runDelivery(prompt, runId, {
        status: 'failed',
        triggeredBy,
        output: '',
        errorMessage: message,
      });
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** Run delivery and persist the per-channel status onto the run row. */
  private async runDelivery(
    prompt: ScheduledPrompt,
    runId: string,
    payload: Omit<DeliveryPayload, 'runId'>,
  ): Promise<void> {
    try {
      const deliveryStatus = await this.delivery.deliver(prompt, {
        runId,
        ...payload,
      });
      if (Object.keys(deliveryStatus).length > 0) {
        await this.db
          .update(scheduledPromptRuns)
          .set({ deliveryStatus })
          .where(eq(scheduledPromptRuns.id, runId));
      }
    } catch (err) {
      // Delivery is best-effort and must never turn a finished run into a
      // failure or escape the run lifecycle.
      this.logger.error(
        `AI Cron delivery for run ${runId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
