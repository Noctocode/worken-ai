import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { scheduledPromptRuns, scheduledPrompts } from '@worken/database/schema';
import { ChatService } from '../chat/chat.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import {
  ChatTransportService,
  ESTIMATED_COMPLETION_TOKENS,
} from '../integrations/chat-transport.service.js';
import { KnowledgeIngestionService } from '../knowledge-core/knowledge-ingestion.service.js';
import { OpenRouterCatalogService } from '../models/openrouter-catalog.service.js';
import { ModelsService } from '../models/models.service.js';
import { ObservabilityService } from '../observability/observability.service.js';
import { DeliveryService, type DeliveryPayload } from './delivery.service.js';
import { ScheduleKnowledgeService } from './schedule-knowledge.service.js';

type ScheduledPrompt = typeof scheduledPrompts.$inferSelect;

// Refresh the run heartbeat at this cadence while a model call is in flight,
// comfortably inside the scheduler's 5-min stale-heartbeat reaper window.
const HEARTBEAT_INTERVAL_MS = 60_000;
// How many knowledge-core chunks to retrieve as context when RAG is enabled.
const RAG_TOP_K = 5;
// Upper-bound completion size used for the pre-flight cost estimate (matches
// the chat path's budget pre-check).
// Shared pre-flight completion-token ceiling (single source of truth).
const MAX_COMPLETION_TOKENS_EST = ESTIMATED_COMPLETION_TOKENS;
// Flat surcharge added to the estimate when web search is on (mirrors chat).
const WEB_SEARCH_SURCHARGE_USD = 0.005;

interface UsageTotals {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

/**
 * A pre-content failure worth switching models for — a dead/unavailable model
 * rather than a genuine prompt error. Mirrors the chat path's classifier so
 * scheduled runs fall back on the same conditions.
 */
function isRetryableModelError(status?: number, message?: string): boolean {
  const m = (message ?? '').toLowerCase();
  return (
    m.includes('no endpoints found') ||
    m.includes('model not found') ||
    // OpenRouter 400 for an unknown model id — scoped to 400 so an unrelated
    // bad-request that happens to contain the phrase doesn't trigger fallback.
    (status === 400 && m.includes('not a valid model')) ||
    status === 404 ||
    (status != null && status >= 500)
  );
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
    private readonly scheduleKnowledge: ScheduleKnowledgeService,
    private readonly catalog: OpenRouterCatalogService,
    private readonly modelsService: ModelsService,
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
    // Per-key token reservations made by the limit gate this run; released
    // in the finally so reserved tokens free up immediately.
    const reservationIds: string[] = [];

    try {
      // Curation gate: if the schedule's model was disabled or deleted in
      // Management → Models since it was set, fail the run with a clear,
      // actionable MODEL_UNAVAILABLE (stored in errorMessage + delivered)
      // instead of silently routing elsewhere. The run-history dialog
      // humanizes the marker into "enable it or pick another".
      await this.modelsService.assertModelAvailable(
        prompt.ownerId,
        prompt.modelIdentifier,
      );

      transport = await this.chatTransport.resolve({
        userId: prompt.ownerId,
        modelIdentifier: prompt.modelIdentifier,
        teamId: prompt.teamId,
      });

      // 1. Build the model context (model-independent). Order: the schedule's
      //    own context text, then its attached files, then the broader
      //    knowledge core (opt-in).
      const contextParts: string[] = [];
      if (prompt.context?.trim()) {
        contextParts.push(prompt.context.trim());
      }
      const scheduleFileIds = await this.scheduleKnowledge.getAttachedFileIds(
        prompt.id,
      );
      if (scheduleFileIds.length > 0) {
        const fileChunks =
          await this.knowledgeIngestion.searchScheduleAttachedChunks(
            prompt.ownerId,
            scheduleFileIds,
            prompt.prompt,
          );
        for (const c of fileChunks) contextParts.push(c.content);
      }
      if (prompt.useKnowledgeCore) {
        const chunks = await this.knowledgeIngestion.searchAccessibleChunks(
          prompt.ownerId,
          prompt.prompt,
          RAG_TOP_K,
        );
        for (const c of chunks) contextParts.push(c.content);
      }
      const context =
        contextParts.length > 0 ? contextParts.join('\n\n---\n\n') : undefined;

      // Rough prompt-token estimate (~4 chars/token) for the pre-flight budget
      // gate below — same upper-bound approach as the chat path.
      const promptTokens = Math.ceil(
        (prompt.prompt.length + (context?.length ?? 0)) / 4,
      );

      // For a scheduled prompt the per-schedule web-search toggle is the
      // sole authority — it is NOT gated by the org/team capability switch
      // (unlike interactive chat). The form only lets the toggle turn on for
      // models that support web search, and the route check below keeps it
      // to the managed route where the plugin actually applies.
      const webAllowed = prompt.useWebSearch;

      // 2. Candidates = the chosen model + its configured fallbacks (Models
      //    tab). On a retryable failure (dead/unavailable model) before any
      //    content, switch to the next candidate — mirroring the chat path.
      //    No first-token timeout: a scheduled run has no live consumer, so a
      //    slow-but-valid model shouldn't be killed.
      const fallbacks = await this.chatTransport.resolveFallbackModels({
        userId: prompt.ownerId,
        modelIdentifier: prompt.modelIdentifier,
        teamId: prompt.teamId,
      });
      const candidates = [
        prompt.modelIdentifier,
        ...fallbacks.filter((m) => m !== prompt.modelIdentifier),
      ];

      let output = '';
      let usage: UsageTotals | undefined;
      let citations: { url: string; title?: string }[] | undefined;
      let usedTransport = transport;
      let produced = false;
      let lastError: string | undefined;

      for (let i = 0; i < candidates.length; i++) {
        const t =
          i === 0
            ? transport
            : await this.chatTransport.resolve({
                userId: prompt.ownerId,
                modelIdentifier: candidates[i],
                teamId: prompt.teamId,
              });
        const webSearch = webAllowed && t.source === 'openrouter';

        // Budget gate — managed/team OpenRouter spend only (BYOK/Custom is
        // user-paid, so caps don't apply). Same gates the chat path runs. A
        // cap block isn't model-specific, but a later BYOK/Custom candidate
        // would bypass it, so on a block we try the next candidate; if the
        // last candidate is blocked the run fails with the cap message.
        if (t.source === 'openrouter') {
          try {
            await this.chatTransport.assertManagedBudgetApproved(
              t,
              prompt.ownerId,
              { teamId: prompt.teamId },
            );
            const estUsd = await this.catalog.estimateCost(
              t.model,
              promptTokens,
              MAX_COMPLETION_TOKENS_EST,
            );
            const estCents = Math.ceil(
              ((estUsd ?? 0) + (webSearch ? WEB_SEARCH_SURCHARGE_USD : 0)) *
                100,
            );
            await this.chatTransport.assertTeamMemberCapNotExceeded(
              prompt.ownerId,
              { teamId: prompt.teamId, estimatedCostCents: estCents },
            );
            await this.chatTransport.assertTeamBudgetNotExceeded({
              teamId: prompt.teamId,
              estimatedCostCents: estCents,
            });
            await this.chatTransport.assertOrgBudgetNotExceeded({
              estimatedCostCents: estCents,
              callerUserId: prompt.ownerId,
            });
          } catch (gateErr) {
            lastError =
              gateErr instanceof Error ? gateErr.message : String(gateErr);
            this.logger.warn(
              `AI Cron run ${runId}: ${candidates[i]} blocked by budget (${lastError}).`,
            );
            if (i < candidates.length - 1) continue;
            break;
          }
        } else {
          // BYOK / Custom: WorkenAI budgets don't apply, but the key's own
          // monthly token limit does — same gate the chat / arena paths run,
          // so a paused or over-limit shared key can't be drained via a
          // scheduled prompt. Fall through to the next candidate on a block.
          try {
            const resId =
              await this.chatTransport.assertIntegrationLimitNotExceeded(
                t,
                prompt.ownerId,
                { estimatedTokens: promptTokens + MAX_COMPLETION_TOKENS_EST },
              );
            if (resId) reservationIds.push(resId);
          } catch (gateErr) {
            lastError =
              gateErr instanceof Error ? gateErr.message : String(gateErr);
            this.logger.warn(
              `AI Cron run ${runId}: ${candidates[i]} blocked by key limit (${lastError}).`,
            );
            if (i < candidates.length - 1) continue;
            break;
          }
        }

        let attemptOutput = '';
        let attemptUsage: UsageTotals | undefined;
        let attemptCitations: { url: string; title?: string }[] | undefined;
        let attemptError: string | undefined;
        let attemptStatus: number | undefined;

        for await (const ev of this.chat.sendMessageStream(
          [{ role: 'user' as const, content: prompt.prompt }],
          t.model,
          false, // no reasoning channel needed for a stored result
          context,
          t.apiKey,
          t.baseURL,
          t.kind,
          {
            webSearch,
            azureEndpoint: t.azureEndpoint,
            azureApiVersion: t.azureApiVersion,
          },
        )) {
          if (ev.type === 'content') attemptOutput += ev.delta;
          else if (ev.type === 'usage') attemptUsage = ev;
          else if (ev.type === 'citations') attemptCitations = ev.citations;
          else if (ev.type === 'error') {
            attemptError = ev.message;
            attemptStatus = ev.status;
          }
        }

        // Any streamed content counts as a usable result even if the stream
        // errored mid-way — keep the partial output rather than discard it and
        // re-bill a fallback. Only a pre-content failure (no output) falls
        // through to the next candidate.
        if (attemptOutput || !attemptError) {
          output = attemptOutput;
          usage = attemptUsage;
          citations = attemptCitations;
          usedTransport = t;
          produced = true;
          break;
        }

        lastError = attemptError;
        const hasNext = i < candidates.length - 1;
        if (hasNext && isRetryableModelError(attemptStatus, attemptError)) {
          this.logger.warn(
            `AI Cron run ${runId}: ${candidates[i]} failed (${attemptError}); falling back to ${candidates[i + 1]}.`,
          );
          continue;
        }
        break;
      }

      const latencyMs = Date.now() - startedAt.getTime();
      if (!produced || !usedTransport) {
        throw new Error(lastError ?? 'Model produced no output.');
      }

      await this.observability.recordLLMCall({
        userId: prompt.ownerId,
        teamId: prompt.teamId,
        integrationId: usedTransport.integrationId ?? null,
        eventType: 'ai_cron_run',
        model: usedTransport.model,
        provider: usedTransport.provider,
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
          model: usedTransport.model,
          provider: usedTransport.provider,
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
          integrationId: transport?.integrationId ?? null,
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
      await Promise.all(
        reservationIds.map((id) =>
          this.chatTransport.releaseIntegrationReservation(id),
        ),
      );
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
