import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { and, desc, eq } from 'drizzle-orm';
import { arenaRuns } from '@worken/database/schema';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { ChatService } from '../chat/chat.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import {
  GUARDRAIL_BLOCKED_MARKER,
  GuardrailEvaluatorService,
} from '../guardrails/guardrail-evaluator.service.js';
import {
  ChatTransportService,
  type ChatTransport,
} from '../integrations/chat-transport.service.js';
import { OpenRouterCatalogService } from '../models/openrouter-catalog.service.js';
import { ObservabilityService } from '../observability/observability.service.js';
import { KnowledgeIngestionService } from '../knowledge-core/knowledge-ingestion.service.js';
import { CompareModelsService } from './compare-models.service.js';

const ATTACHMENT_MAX_BYTES = 30 * 1024 * 1024;

const MAX_COMPARE_ATTEMPTS = 3;

// Default "judge" model that scores the arena answers. A capable
// evaluator must outclass the models it grades, so the default is a
// strong, JSON-reliable model with a low enough output price that it
// won't surprise the caller's personal budget (the judge bills it):
// Gemini 2.5 Flash — solid reasoning, 1M context, ~$0.30/$2.50 per M.
// Override without a deploy via the ARENA_JUDGE_MODEL env var, or
// per-run via the request body (`judgeModel`, set by the UI selector).
const DEFAULT_JUDGE_MODEL = 'google/gemini-2.5-flash';

function resolveJudgeModel(requested?: unknown): string {
  // Tolerate a non-string `judgeModel` in the body — a bad client
  // shouldn't 500 here; we just fall through to the env/default.
  const fromRequest = typeof requested === 'string' ? requested.trim() : '';
  if (fromRequest) return fromRequest;
  const fromEnv = process.env['ARENA_JUDGE_MODEL']?.trim();
  return fromEnv || DEFAULT_JUDGE_MODEL;
}

interface CompareModelsRequestBody {
  models: string[];
  question: string;
  expectedOutput: string;
  context?: string;
  /** Optional per-run judge override (UI selector). Falls back to
   *  ARENA_JUDGE_MODEL env / DEFAULT_JUDGE_MODEL when absent. */
  judgeModel?: string;
}

interface ModelResponse {
  model: string;
  response: {
    content: string;
    reasoning_details?: unknown;
  };
  totalTokens: number | undefined;
  totalCost: number | undefined;
  time: number;
}

interface RawComparisonItem {
  name: string;
  score: number;
  advantages: string[] | string;
  disadvantages: string[] | string;
  summary: string;
}

interface ComparisonItem {
  name: string;
  score: number;
  advantages: string[];
  disadvantages: string[];
  summary: string;
  totalTokens?: number;
  totalCost?: number;
  time?: number;
}

@Controller('compare-models')
export class CompareModelsController {
  private readonly logger = new Logger(CompareModelsController.name);

  constructor(
    private readonly compareModelsService: CompareModelsService,
    private readonly chatService: ChatService,
    private readonly chatTransport: ChatTransportService,
    private readonly catalogService: OpenRouterCatalogService,
    private readonly observabilityService: ObservabilityService,
    private readonly guardrails: GuardrailEvaluatorService,
    private readonly knowledgeIngestion: KnowledgeIngestionService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  private normalizeStringArray(value: string[] | string): string[] {
    if (Array.isArray(value)) return value;
    return value
      .split(/\n|^\s*-\s*|\\n|•/gm)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private parseComparisonContent(content: string): ComparisonItem[] {
    const jsonStart = content.indexOf('[');
    const jsonEnd = content.lastIndexOf(']');
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) return [];

    // Strip non-JSON wrapping text and normalize line breaks inside strings
    const cleaned = content
      .slice(jsonStart, jsonEnd + 1)
      .replace(/\r?\n(?!\s*[-\]])/g, ' ');

    const parsed = JSON.parse(cleaned) as unknown;
    if (!Array.isArray(parsed)) return [];

    return (parsed as RawComparisonItem[]).map((item) => {
      const advantages = this.normalizeStringArray(item.advantages);
      const disadvantages = this.normalizeStringArray(item.disadvantages);

      if (advantages.length === 0 && disadvantages.length === 0) {
        throw new Error('No advantages or disadvantages found');
      }

      return {
        name: item.name,
        score: item.score,
        summary: item.summary,
        advantages,
        disadvantages,
      };
    });
  }

  /**
   * Streaming arena endpoint. Fans the question out to N models in
   * parallel and pipes their token deltas to the FE over SSE — each
   * event tagged with the model id so the FE can route to the
   * correct panel.
   *
   * Pre-flight (body validation, evaluator key resolve, team scope,
   * guardrail INPUT) runs BEFORE SSE headers are flushed so any
   * failure there still comes back as a regular JSON 4xx the FE
   * humanizer can route. Per-model transport / budget gates run
   * AFTER headers — failures there become `model-error` SSE events
   * that close only the affected panel.
   *
   * Event shapes (data is JSON-encoded):
   *   - `model-delta`   {model,text}                  visible token piece
   *   - `model-replace` {model,text}                  full-text overwrite
   *                                                   after per-model
   *                                                   output guardrail
   *                                                   fix-rule pass.
   *   - `model-error`   {model,message,status?}       per-model failure
   *                                                   (budget gate,
   *                                                   provider error,
   *                                                   output BLOCK).
   *   - `model-done`    {model,totalTokens,costUsd,time}  per-model
   *                                                   summary after
   *                                                   its stream and
   *                                                   guardrail
   *                                                   complete.
   *   - `evaluation`    {comparisonItems,runId}       evaluator output
   *                                                   after ALL models
   *                                                   complete.
   *   - `done`          {}                            end-of-stream.
   *
   * Cancellation: same pattern as chat-controller — req.on('close')
   * aborts every in-flight upstream call via a shared AbortController.
   */
  @Post('stream')
  async compareModelsStream(
    @Body() body: CompareModelsRequestBody,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // ── PRE-FLIGHT (mirrors POST /compare-models) ───────────────────
    if (!Array.isArray(body?.models) || body.models.length === 0) {
      throw new BadRequestException('`models` must be a non-empty array.');
    }
    const cleanedModels: string[] = [];
    const seen = new Set<string>();
    for (const m of body.models) {
      if (typeof m !== 'string') {
        throw new BadRequestException('`models` entries must be strings.');
      }
      const trimmed = m.trim();
      if (!trimmed) {
        throw new BadRequestException('`models` entries must be non-empty.');
      }
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      cleanedModels.push(trimmed);
    }
    body.models = cleanedModels;

    if (!body.question?.trim()) {
      throw new BadRequestException('`question` is required.');
    }
    if (
      body.expectedOutput !== undefined &&
      typeof body.expectedOutput !== 'string'
    ) {
      throw new BadRequestException(
        '`expectedOutput` must be a string when provided.',
      );
    }
    body.expectedOutput = body.expectedOutput ?? '';

    // Arena is Personal-only — every run (the compared models AND the
    // hidden judge) bills against the caller's own key / budget, never
    // a team or our shared general key. `teamId: null` keeps the
    // routing on the personal tier.
    const teamId: string | null = null;

    // Resolve the judge model + its transport up front so a key/route
    // failure comes back as a regular JSON 4xx before SSE headers
    // flush. Routed through ChatTransportService exactly like a normal
    // personal model call: personal OpenRouter key, or the user's own
    // BYOK for that model. Same mechanism, same billing.
    const judgeModel = resolveJudgeModel(body.judgeModel);
    let judgeTransport: ChatTransport;
    try {
      judgeTransport = await this.chatTransport.resolve({
        userId: user.id,
        modelIdentifier: judgeModel,
        teamId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Judge transport resolve failed for user ${user.id}: ${msg}`,
      );
      throw new ServiceUnavailableException(
        `AI gateway key unavailable: ${msg}`,
      );
    }
    // Surfaced to the FE so it can warn that the judge also graded its
    // own answer (possible self-evaluation bias) when the user put the
    // judge model into the comparison set.
    const selfJudge = body.models.includes(judgeModel);

    const inputDecision = await this.guardrails.evaluate({
      text: body.question,
      target: 'input',
      userId: user.id,
      teamId,
    });
    if (inputDecision.blocked) {
      throw new HttpException(
        `${GUARDRAIL_BLOCKED_MARKER}: "${inputDecision.blocked.ruleName}" blocked your question (${inputDecision.blocked.validator}). Edit it and try again, or ask an admin to adjust the rule in Management → Guardrails.`,
        422,
      );
    }
    const safeQuestion = inputDecision.text;

    // RAG: same compose pattern as non-stream arena.
    let ragContext = '';
    try {
      const ragChunks = await this.knowledgeIngestion.searchAccessibleChunks(
        user.id,
        safeQuestion,
      );
      ragContext = ragChunks.map((c) => c.content).join('\n\n---\n\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `RAG search failed for user ${user.id}; continuing without retrieved context: ${msg}`,
      );
    }
    const composedContext = [ragContext, body.context]
      .filter((s) => s && s.trim().length > 0)
      .join('\n\n---\n\n');

    // ── SSE HEADERS — past this point, everything is an SSE event ───
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Single write per SSE frame is critical here: N model streams
    // run in parallel via Promise.allSettled, so two separate
    // res.write calls for `event:` and `data:` could interleave
    // (`event:` from task A, `event:` from task B, then both `data:`)
    // and produce malformed frames the FE parser mis-splits. One
    // concatenated write keeps each frame atomic.
    //
    // Also guard against post-disconnect writes — `req.on('close')`
    // fires while in-flight per-model tasks may still try to
    // sendEvent. Without this check a stale write would throw EPIPE
    // / write-after-end and crash the handler.
    const sendEvent = (event: string, data: unknown) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const abortController = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) abortController.abort();
    });

    // ── PER-MODEL FAN-OUT ───────────────────────────────────────────
    const responses: ModelResponse[] = [];
    await Promise.allSettled(
      body.models.map(async (model) => {
        const modelStart = Date.now();

        // Per-model pre-flight that mirrors the inline block in the
        // non-stream arena. Failures here become a model-error SSE
        // event so only this panel shows the failure; the rest keep
        // streaming.
        // Model attempt list: requested model first, then its configured
        // fallbacks (in order). A retryable failure (dead/unavailable model —
        // "no endpoints found", 404, provider 5xx) before any token reaches
        // this panel switches to the next candidate. `usedModel` records which
        // one actually answered so the FE can show the substituted model.
        const fallbackModels = await this.chatTransport.resolveFallbackModels({
          userId: user.id,
          modelIdentifier: model,
          teamId,
        });
        const candidates = [model, ...fallbackModels];
        // Fall back if a candidate emits no token within this window AND a
        // fallback exists ("timeouts (3s) or returns error" per Models tab).
        const FALLBACK_FIRST_TOKEN_TIMEOUT_MS = 3000;
        const isRetryableModelError = (status?: number, message?: string) => {
          const m = (message ?? '').toLowerCase();
          return (
            m.includes('no endpoints found') ||
            m.includes('model not found') ||
            status === 404 ||
            (status != null && status >= 500)
          );
        };

        let transport: ChatTransport | null = null;
        let usedModel = model;
        let buffer = '';
        let promptTokens: number | undefined;
        let completionTokens: number | undefined;
        let totalTokens: number | undefined;
        let costUsd: number | undefined;
        let modelErrored = false;
        let errorPayload: { message: string; status?: number } | null = null;
        let preflightFailed = false;

        for (let ci = 0; ci < candidates.length; ci++) {
          const candidate = candidates[ci];

          // Per-candidate pre-flight (transport + budget gates). A failure
          // here is a budget/approval problem, not model availability — it
          // ends the panel rather than falling back.
          let t: ChatTransport;
          try {
            t = await this.chatTransport.resolve({
              userId: user.id,
              modelIdentifier: candidate,
              teamId,
            });
            await this.chatTransport.assertManagedBudgetApproved(t, user.id, {
              teamId,
            });
            const promptTok = Math.ceil(safeQuestion.length / 4);
            const estimatedCostUsd = await this.catalogService.estimateCost(
              candidate,
              promptTok,
              4096,
            );
            const estimatedCostCents =
              estimatedCostUsd != null ? Math.ceil(estimatedCostUsd * 100) : 0;
            await this.chatTransport.assertTeamMemberCapNotExceeded(user.id, {
              teamId,
              estimatedCostCents,
            });
            await this.chatTransport.assertTeamBudgetNotExceeded({
              teamId,
              estimatedCostCents,
            });
            await this.chatTransport.assertOrgBudgetNotExceeded({
              estimatedCostCents,
              callerUserId: user.id,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const status =
              err instanceof HttpException ? err.getStatus() : undefined;
            sendEvent('model-error', { model, message: msg, status });
            void this.observabilityService.recordLLMCall({
              userId: user.id,
              teamId,
              eventType: 'arena_call',
              model: candidate,
              latencyMs: Date.now() - modelStart,
              success: false,
              errorMessage: msg,
              prompt: safeQuestion,
              metadata: { streamed: true },
            });
            preflightFailed = true;
            break;
          }

          // Stream. Reasoning is OFF for arena — no thinking pane. A pre-token
          // error from a dead model is retried with the next candidate.
          //
          // First-token timeout: abort + fall back if no token arrives in time,
          // but only when a fallback exists — the final candidate runs to
          // completion so a slow-but-valid model isn't killed. A per-attempt
          // AbortController, OR-ed with the run's abort, distinguishes a
          // timeout from a real cancellation.
          const hasNext = ci < candidates.length - 1;
          const attemptAbort = new AbortController();
          const signal = hasNext
            ? AbortSignal.any([abortController.signal, attemptAbort.signal])
            : abortController.signal;
          let firstTokenSeen = false;
          const timer = hasNext
            ? setTimeout(() => {
                if (!firstTokenSeen) attemptAbort.abort();
              }, FALLBACK_FIRST_TOKEN_TIMEOUT_MS)
            : null;

          let producedOutput = false;
          let attemptError: { message: string; status?: number } | null = null;
          try {
            for await (const event of this.chatService.sendMessageStream(
              [{ role: 'user', content: safeQuestion }],
              t.model,
              false,
              composedContext || undefined,
              t.apiKey,
              t.baseURL,
              t.kind,
              {
                signal,
                azureEndpoint: t.azureEndpoint,
                azureApiVersion: t.azureApiVersion,
              },
            )) {
              if (event.type === 'error') {
                attemptError = { message: event.message, status: event.status };
                break;
              }
              if (!firstTokenSeen) {
                firstTokenSeen = true;
                if (timer) clearTimeout(timer);
              }
              if (event.type === 'content') {
                producedOutput = true;
                buffer += event.delta;
                sendEvent('model-delta', { model, text: event.delta });
              } else if (event.type === 'usage') {
                producedOutput = true;
                promptTokens = event.promptTokens;
                completionTokens = event.completionTokens;
                totalTokens = event.totalTokens;
                costUsd = event.costUsd;
              }
              // `reasoning` events ignored — arena UI has no thinking pane.
            }
          } catch (err) {
            attemptError = {
              message: err instanceof Error ? err.message : String(err),
            };
          } finally {
            if (timer) clearTimeout(timer);
          }

          // The attempt's own abort fired (not the run) before any token →
          // the model was too slow; fall back.
          const timedOut =
            !producedOutput &&
            attemptAbort.signal.aborted &&
            !abortController.signal.aborted;

          // Retry when there's no visible token yet, a fallback exists, and the
          // failure is a timeout or a retryable availability error.
          if (
            !producedOutput &&
            hasNext &&
            (timedOut ||
              (attemptError !== null &&
                isRetryableModelError(
                  attemptError.status,
                  attemptError.message,
                )))
          ) {
            continue;
          }
          transport = t;
          usedModel = candidate;
          if (attemptError) {
            modelErrored = true;
            errorPayload = attemptError;
          }
          break;
        }

        if (preflightFailed || !transport) return;

        // Surface the substituted model so a fallback is never silent.
        if (usedModel !== model) {
          sendEvent('model-fallback', { model, usedModel });
        }

        const latencyMs = Date.now() - modelStart;

        if (modelErrored && errorPayload) {
          sendEvent('model-error', {
            model,
            message: errorPayload.message,
            status: errorPayload.status,
          });
          void this.observabilityService.recordLLMCall({
            userId: user.id,
            teamId,
            eventType: 'arena_call',
            model: usedModel,
            provider: transport.provider,
            latencyMs,
            success: false,
            errorMessage: errorPayload.message,
            prompt: safeQuestion,
            metadata: {
              hasContext: composedContext.length > 0,
              routingSource: transport.source,
              streamed: true,
            },
          });
          return;
        }

        // Per-model output guardrail. A BLOCK closes the model panel;
        // a fix-rule emits a `model-replace` so the visible text
        // swaps to the redacted version after the stream settles.
        const outputDecision = await this.guardrails.evaluate({
          text: buffer,
          target: 'output',
          userId: user.id,
          teamId,
        });
        if (outputDecision.blocked) {
          sendEvent('model-error', {
            model,
            message: `Output blocked by "${outputDecision.blocked.ruleName}" (${outputDecision.blocked.validator}).`,
          });
          void this.observabilityService.recordLLMCall({
            userId: user.id,
            teamId,
            eventType: 'arena_call',
            model: usedModel,
            provider: transport.provider,
            latencyMs,
            success: false,
            errorMessage: 'Output guardrail blocked',
            prompt: safeQuestion,
            metadata: {
              hasContext: composedContext.length > 0,
              routingSource: transport.source,
              streamed: true,
            },
          });
          return;
        }
        const finalText = outputDecision.text;
        if (finalText !== buffer) {
          sendEvent('model-replace', { model, text: finalText });
        }

        // Cost backfill for non-OpenRouter routes — same logic as
        // chat-controller. Native (BYOK / Custom) endpoints don't
        // emit `cost`, so the OpenRouter catalog estimator fills in.
        let resolvedCostUsd = costUsd;
        if (
          resolvedCostUsd == null &&
          transport.source !== 'openrouter' &&
          promptTokens != null &&
          completionTokens != null
        ) {
          const estimated = await this.catalogService.estimateCost(
            usedModel,
            promptTokens,
            completionTokens,
          );
          if (estimated != null) resolvedCostUsd = estimated;
        }

        void this.observabilityService.recordLLMCall({
          userId: user.id,
          teamId,
          eventType: 'arena_call',
          model,
          provider: transport.provider,
          totalTokens,
          costUsd: resolvedCostUsd ?? null,
          latencyMs,
          success: true,
          prompt: safeQuestion,
          metadata: {
            hasContext: composedContext.length > 0,
            routingSource: transport.source,
            streamed: true,
          },
        });

        responses.push({
          model,
          response: { content: finalText },
          totalTokens,
          totalCost: resolvedCostUsd,
          time: latencyMs,
        });

        sendEvent('model-done', {
          model,
          // The model that actually answered (differs from `model` when a
          // fallback was used), so the panel can label the real model.
          usedModel,
          totalTokens,
          costUsd: resolvedCostUsd,
          time: latencyMs,
        });
      }),
    );

    // ── EVALUATOR ────────────────────────────────────────────────────
    // If every model errored, skip the evaluator (nothing meaningful
    // to compare) and emit done with empty comparison.
    let comparisonItems: ComparisonItem[] = [];
    let evaluatorError: string | null = null;
    if (responses.length > 0) {
      let lastParseError: string | undefined;
      let lastRawContent = '';
      let lastCallError: string | undefined;

      // Same retry policy as the non-stream arena: try up to
      // MAX_COMPARE_ATTEMPTS times, accept the first attempt that
      // produces a non-empty parsed comparison. Call failures
      // accumulate into lastCallError; parse failures into
      // lastParseError. The retry helps with the evaluator
      // sometimes returning markdown / preamble around the JSON.
      for (let attempt = 1; attempt <= MAX_COMPARE_ATTEMPTS; attempt++) {
        const evalStart = Date.now();
        try {
          const comparison =
            await this.compareModelsService.compareModelAnswers(
              responses,
              body.expectedOutput,
              judgeTransport.model,
              false,
              judgeTransport.apiKey,
              judgeTransport.baseURL,
              judgeTransport.kind,
              judgeTransport.azureEndpoint,
              judgeTransport.azureApiVersion,
            );
          // OpenRouter returns cost inline; BYOK / Custom don't, so
          // estimate from the catalog. Either way the judge call's
          // cost lands on the caller's own usage, never the general key.
          let judgeCostUsd = comparison.totalCost ?? null;
          if (
            judgeCostUsd == null &&
            comparison.promptTokens != null &&
            comparison.completionTokens != null
          ) {
            judgeCostUsd = await this.catalogService.estimateCost(
              judgeModel,
              comparison.promptTokens,
              comparison.completionTokens,
            );
          }
          void this.observabilityService.recordLLMCall({
            userId: user.id,
            teamId,
            eventType: 'evaluator_call',
            model: judgeModel,
            latencyMs: Date.now() - evalStart,
            success: true,
            totalTokens: comparison.totalTokens,
            costUsd: judgeCostUsd ?? undefined,
            metadata: {
              attempt,
              streamed: true,
              source: judgeTransport.source,
              selfJudge,
            },
          });
          lastRawContent = comparison.content ?? '';
          try {
            comparisonItems = this.parseComparisonContent(lastRawContent);
          } catch (err) {
            lastParseError = err instanceof Error ? err.message : String(err);
            comparisonItems = [];
          }
          if (comparisonItems.length > 0) break;
          this.logger.warn(
            `Evaluator returned unparseable output on attempt ${attempt}/${MAX_COMPARE_ATTEMPTS}${
              lastParseError ? ` (${lastParseError})` : ''
            }. Raw content preview: ${lastRawContent.slice(0, 200)}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          lastCallError = msg;
          void this.observabilityService.recordLLMCall({
            userId: user.id,
            teamId,
            eventType: 'evaluator_call',
            model: judgeModel,
            latencyMs: Date.now() - evalStart,
            success: false,
            errorMessage: msg,
            metadata: {
              attempt,
              streamed: true,
              source: judgeTransport.source,
              selfJudge,
            },
          });
          this.logger.error(
            `Evaluator call failed on attempt ${attempt}/${MAX_COMPARE_ATTEMPTS}: ${msg}`,
          );
          // Retry — could be a transient rate limit. The last error
          // message gets surfaced if every attempt fails.
        }
      }

      if (comparisonItems.length === 0) {
        // Surface a single failure reason — the user has the model
        // answers already; missing scores need an explicit error so
        // the FE doesn't quietly hide the (now non-existent)
        // evaluation card.
        evaluatorError =
          lastCallError ??
          lastParseError ??
          'Evaluator produced no parseable comparison.';
        this.logger.error(
          `Evaluator failed after ${MAX_COMPARE_ATTEMPTS} attempts for user ${user.id}: ${evaluatorError}`,
        );
      }
    }

    const comparisonWithMetrics = comparisonItems.map((item) => {
      const modelResponse = responses.find((r) => r.model === item.name);
      return {
        ...item,
        totalTokens: modelResponse?.totalTokens,
        totalCost: modelResponse?.totalCost,
        time: modelResponse?.time,
      };
    });

    // ── PERSIST ARENA RUN ────────────────────────────────────────────
    let runId: string | undefined;
    if (responses.length > 0) {
      try {
        const [row] = await this.db
          .insert(arenaRuns)
          .values({
            userId: user.id,
            question: body.question,
            expectedOutput: body.expectedOutput ?? '',
            models: body.models,
            responses,
            comparison: comparisonWithMetrics,
            judgeModel,
          })
          .returning({ id: arenaRuns.id });
        runId = row?.id;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to persist arena run for user ${user.id}: ${msg}`,
        );
      }
    }

    if (!res.writableEnded) {
      sendEvent('evaluation', {
        comparisonItems: comparisonWithMetrics,
        runId,
        // The judge model that produced these scores + whether it also
        // graded its own answer, so the FE can label the evaluator and
        // warn about possible self-evaluation bias.
        judgeModel,
        selfJudge,
        // When every retry of the evaluator failed (or produced
        // unparseable JSON), surface the underlying reason so the
        // FE can show a toast / banner — better UX than silently
        // hiding the score cards. Empty when evaluator succeeded.
        error: evaluatorError ?? undefined,
      });
      sendEvent('done', {});
      res.end();
    }
  }

  // The judge used when the caller doesn't pick one — resolved live
  // (ARENA_JUDGE_MODEL env / DEFAULT_JUDGE_MODEL) so the UI can name it
  // without hardcoding. `name` is the catalog display name (provider
  // prefix stripped), falling back to the raw id.
  @Get('judge-default')
  async judgeDefault() {
    const id = resolveJudgeModel();
    let name = id;
    try {
      const catalog = await this.catalogService.list();
      const match = catalog.find((m) => m.id === id);
      if (match?.name) name = match.name.split(': ').pop() ?? match.name;
    } catch {
      // Catalog unavailable — the raw id is a fine fallback.
    }
    return { id, name };
  }

  @Get('runs')
  async listRuns(@CurrentUser() user: AuthenticatedUser) {
    const rows = await this.db
      .select({
        id: arenaRuns.id,
        question: arenaRuns.question,
        // models is `jsonb` on the row — the FE renders avatars per
        // model, so include it in the summary so the dashboard /
        // sidebar don't have to round-trip back through /runs/:id.
        models: arenaRuns.models,
        createdAt: arenaRuns.createdAt,
      })
      .from(arenaRuns)
      .where(eq(arenaRuns.userId, user.id))
      .orderBy(desc(arenaRuns.createdAt))
      .limit(50);

    return rows.map((r) => ({
      ...r,
      models: Array.isArray(r.models) ? (r.models as string[]) : [],
    }));
  }

  @Get('runs/:id')
  async getRun(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const [row] = await this.db
      .select()
      .from(arenaRuns)
      .where(and(eq(arenaRuns.id, id), eq(arenaRuns.userId, user.id)));

    if (!row) {
      throw new NotFoundException('Arena run not found.');
    }

    return {
      id: row.id,
      question: row.question,
      expectedOutput: row.expectedOutput,
      models: row.models as string[],
      responses: row.responses as ModelResponse[],
      comparison: row.comparison as ComparisonItem[],
      favoriteModel: row.favoriteModel ?? null,
      judgeModel: row.judgeModel ?? null,
      createdAt: row.createdAt,
    };
  }

  /**
   * Mark (or clear) the model whose answer the user liked best for a run.
   * `favoriteModel: null` clears it. Must be one of the run's models.
   */
  @Patch('runs/:id')
  async updateRunFavorite(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { favoriteModel?: string | null },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Require the field explicitly — a string to set, or null to clear. An
    // absent field would otherwise silently wipe the saved pick, which is
    // surprising PATCH behaviour and easy to trigger by accident.
    if (body.favoriteModel === undefined) {
      throw new BadRequestException(
        '`favoriteModel` is required (a model id to set, or null to clear).',
      );
    }
    if (body.favoriteModel !== null && typeof body.favoriteModel !== 'string') {
      throw new BadRequestException(
        '`favoriteModel` must be a string or null.',
      );
    }

    const [row] = await this.db
      .select({ models: arenaRuns.models })
      .from(arenaRuns)
      .where(and(eq(arenaRuns.id, id), eq(arenaRuns.userId, user.id)));
    if (!row) {
      throw new NotFoundException('Arena run not found.');
    }

    const favorite = body.favoriteModel;
    const models = Array.isArray(row.models) ? (row.models as string[]) : [];
    if (favorite !== null && !models.includes(favorite)) {
      throw new BadRequestException(
        '`favoriteModel` must be one of the run’s models.',
      );
    }

    await this.db
      .update(arenaRuns)
      .set({ favoriteModel: favorite })
      .where(and(eq(arenaRuns.id, id), eq(arenaRuns.userId, user.id)));

    return { id, favoriteModel: favorite };
  }

  @Delete('runs/:id')
  @HttpCode(204)
  async deleteRun(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    const deleted = await this.db
      .delete(arenaRuns)
      .where(and(eq(arenaRuns.id, id), eq(arenaRuns.userId, user.id)))
      .returning({ id: arenaRuns.id });

    if (deleted.length === 0) {
      throw new NotFoundException('Arena run not found.');
    }
  }

  @Post('attachments/parse')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: ATTACHMENT_MAX_BYTES },
    }),
  )
  async parseAttachment(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ name: string; content: string }> {
    if (!file) {
      throw new BadRequestException('No file was uploaded.');
    }

    const mimetype = file.mimetype;
    const name = file.originalname;
    const lowerName = name.toLowerCase();

    let content: string;

    try {
      if (mimetype === 'application/pdf' || lowerName.endsWith('.pdf')) {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: file.buffer });
        const result = await parser.getText();
        content = result.text;
      } else if (
        mimetype ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        lowerName.endsWith('.docx')
      ) {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        content = result.value;
      } else if (
        mimetype.startsWith('text/') ||
        mimetype === 'application/json' ||
        mimetype === 'application/xml'
      ) {
        content = file.buffer.toString('utf8');
      } else {
        const dot = lowerName.lastIndexOf('.');
        const ext =
          dot !== -1 && dot < lowerName.length - 1 ? lowerName.slice(dot) : '';
        const detail = ext
          ? `"${ext}" (${mimetype || 'no MIME type'})`
          : `"${mimetype || 'unknown type'}"`;
        throw new BadRequestException(
          `Unsupported file type ${detail}. Only PDF, DOCX, and text-based files (TXT, MD, CSV, JSON, code) are allowed.`,
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to parse attachment "${name}": ${msg}`);
      throw new BadRequestException(`Failed to parse "${name}": ${msg}`);
    }

    if (!content.trim()) {
      throw new BadRequestException(
        `No text could be extracted from "${name}". The file may be empty or unreadable.`,
      );
    }

    return { name, content };
  }
}
