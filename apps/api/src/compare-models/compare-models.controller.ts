import {
  BadGatewayException,
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
import { ChatTransportService } from '../integrations/chat-transport.service.js';
import { OpenRouterCatalogService } from '../models/openrouter-catalog.service.js';
import { ObservabilityService } from '../observability/observability.service.js';
import { KeyResolverService } from '../openrouter/key-resolver.service.js';
import { KnowledgeIngestionService } from '../knowledge-core/knowledge-ingestion.service.js';
import { CompareModelsService } from './compare-models.service.js';

const ATTACHMENT_MAX_BYTES = 30 * 1024 * 1024;
const OCR_MODEL = 'baidu/qianfan-ocr-fast:free';
const IMAGE_MIMETYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

const MAX_COMPARE_ATTEMPTS = 3;

interface CompareModelsRequestBody {
  models: string[];
  question: string;
  expectedOutput: string;
  context?: string;
  /** Optional. If omitted, server falls back to the user's primary team. */
  teamId?: string | null;
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
    private readonly keyResolverService: KeyResolverService,
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

  @Post()
  async compareModels(
    @Body() body: CompareModelsRequestBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
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

    // Resolve transport per model below (each can route differently:
    // BYOK / Custom / OpenRouter). The evaluator at the bottom uses
    // OpenRouter regardless, so we still need a base key for it.
    let evaluatorApiKey: string;
    try {
      evaluatorApiKey = await this.keyResolverService.resolveUserKey(user.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Key resolution failed for user ${user.id}: ${msg}`);
      throw new ServiceUnavailableException(
        `AI gateway key unavailable: ${msg}`,
      );
    }

    // Personal-by-default scoping. If the body carries an explicit
    // teamId, validate membership and use it. Anything else
    // (missing / null / empty / "personal") tags the events as
    // Personal, so they show up under the "Personal" row in the
    // Observability team-analytics rollup. The user opts in to a
    // team scope by explicitly selecting one in the composer.
    let teamId: string | null = null;
    const requested = (body.teamId ?? '').trim();
    if (requested && requested !== 'personal' && requested !== 'null') {
      if (!(await this.observabilityService.isUserInTeam(user.id, requested))) {
        throw new BadRequestException(
          'You are not a member of the selected team.',
        );
      }
      teamId = requested;
    }

    // Guardrail INPUT gate. Same prompt is fanned out to every
    // model, so we only need to evaluate it once. Block here saves
    // every per-model LLM call instead of failing N times below.
    // 422 (not 400) for parity with /chat — both surfaces produce
    // the same GUARDRAIL_BLOCKED marker, so the FE humanizer is
    // status-agnostic but logs / metrics treat them as one class.
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

    // RAG: pull in the caller's accessible knowledge chunks (their own
    // 'personal'-scope uploads + any 'company'-scope uploads in the
    // single-tenant deployment) so an arena run can answer questions
    // grounded in the docs the user trained the assistant with. Same
    // source as chat.controller.ts — keeps arena and chat consistent.
    // The user-supplied `body.context` (when present) is appended
    // verbatim so a deliberate context override still works.
    //
    // Wrapped in try/catch so a slow / failing embedder doesn't sink
    // the whole arena run. transformers.js does a cold-start model
    // load on the first call after a restart (~10–30s); the rest of
    // the arena should not block on that. If RAG fails, the call
    // proceeds with body.context only.
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

    let responses: ModelResponse[];
    try {
      responses = await Promise.all(
        body.models.map(async (model) => {
          // Each model resolves its own transport independently — one
          // arena run can mix OpenRouter, BYOK, and Custom routes.
          // Pass the team scope so when the user picked a team in the
          // composer, the OpenRouter fallback bills against the
          // team's key (matches what the pending-approval gate
          // checks below — keeps the gate and the actual spend on
          // the same budget).
          const transport = await this.chatTransport.resolve({
            userId: user.id,
            modelIdentifier: model,
            teamId,
          });
          // Same pending-approval gate as /chat — blocks Managed Cloud
          // calls until an admin sets a budget. BYOK/Custom routes
          // skip the gate (their billing is external).
          await this.chatTransport.assertManagedBudgetApproved(
            transport,
            user.id,
            { teamId },
          );
          // Per-member team cap. Only fires when the composer is
          // scoped to a specific team — Personal arena runs (teamId
          // null) don't have a per-team cap concept. Pre-flight
          // estimate is per-model since arena fans out across many
          // models and each has its own pricing.
          const promptTokens = Math.ceil(safeQuestion.length / 4);
          const estimatedCostUsd = await this.catalogService.estimateCost(
            model,
            promptTokens,
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
          });
          const start = Date.now();
          try {
            const response = await this.compareModelsService.sendQuestion(
              safeQuestion,
              transport.model,
              false,
              composedContext || undefined,
              transport.apiKey,
              transport.baseURL,
              transport.kind,
            );
            const latencyMs = Date.now() - start;

            // Per-model output guardrail. A blocked output for one
            // model doesn't sink the whole arena run — Promise.all's
            // map catch below already turns it into a per-model
            // failure card on the FE. The redacted version (when a
            // 'fix'-action rule fires) replaces the LLM text before
            // we return / persist the arena response.
            const outputDecision = await this.guardrails.evaluate({
              text: response.content,
              target: 'output',
              userId: user.id,
              teamId,
            });
            if (outputDecision.blocked) {
              throw new Error(
                `${GUARDRAIL_BLOCKED_MARKER}: "${outputDecision.blocked.ruleName}" blocked the model's response (${outputDecision.blocked.validator}).`,
              );
            }
            response.content = outputDecision.text;

            // Estimate cost when the route bypassed OpenRouter (BYOK /
            // Custom). Same logic as chat.controller — see commentary
            // there. `model` (not `transport.model`) is what's looked
            // up in the catalog; for BYOK we strip the vendor prefix
            // before sending to the native endpoint, but the catalog
            // still keys on the prefixed id.
            let costUsd = response.totalCost ?? null;
            let costEstimated = false;
            if (
              costUsd == null &&
              transport.source !== 'openrouter' &&
              response.promptTokens != null &&
              response.completionTokens != null
            ) {
              const estimated = await this.catalogService.estimateCost(
                model,
                response.promptTokens,
                response.completionTokens,
              );
              if (estimated != null) {
                costUsd = estimated;
                costEstimated = true;
              }
            }

            void this.observabilityService.recordLLMCall({
              userId: user.id,
              teamId,
              eventType: 'arena_call',
              model,
              provider: transport.provider,
              totalTokens: response.totalTokens,
              costUsd,
              latencyMs,
              success: true,
              prompt: safeQuestion,
              metadata: {
                hasContext: composedContext.length > 0,
                routingSource: transport.source,
                costEstimated,
              },
            });
            return {
              model,
              response,
              time: latencyMs,
              totalTokens: response.totalTokens,
              totalCost: costUsd ?? undefined,
            };
          } catch (err) {
            const latencyMs = Date.now() - start;
            const msg = err instanceof Error ? err.message : String(err);
            void this.observabilityService.recordLLMCall({
              userId: user.id,
              teamId,
              eventType: 'arena_call',
              model,
              provider: transport.provider,
              latencyMs,
              success: false,
              errorMessage: msg,
              prompt: safeQuestion,
              metadata: {
                hasContext: composedContext.length > 0,
                routingSource: transport.source,
              },
            });
            throw err;
          }
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Model completion failed: ${msg}`);
      throw new BadGatewayException(msg);
    }

    let comparisonItems: ComparisonItem[] = [];
    let lastParseError: string | undefined;
    let lastRawContent = '';

    const EVALUATOR_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';
    for (let attempt = 1; attempt <= MAX_COMPARE_ATTEMPTS; attempt++) {
      let comparison;
      const evalStart = Date.now();
      try {
        comparison = await this.compareModelsService.compareModelAnswers(
          responses,
          body.expectedOutput,
          EVALUATOR_MODEL,
          false,
          evaluatorApiKey,
        );
        void this.observabilityService.recordLLMCall({
          userId: user.id,
          teamId,
          eventType: 'evaluator_call',
          model: EVALUATOR_MODEL,
          latencyMs: Date.now() - evalStart,
          success: true,
          metadata: { attempt },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void this.observabilityService.recordLLMCall({
          userId: user.id,
          teamId,
          eventType: 'evaluator_call',
          model: EVALUATOR_MODEL,
          latencyMs: Date.now() - evalStart,
          success: false,
          errorMessage: msg,
          metadata: { attempt },
        });
        this.logger.error(
          `Evaluator call failed on attempt ${attempt}/${MAX_COMPARE_ATTEMPTS}: ${msg}`,
        );
        throw new BadGatewayException(`Evaluator model failed: ${msg}`);
      }

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
    }

    if (comparisonItems.length === 0) {
      this.logger.error(
        `Evaluator failed to produce valid JSON for user ${user.id} after ${MAX_COMPARE_ATTEMPTS} attempts.${
          lastParseError ? ` Last parse error: ${lastParseError}.` : ''
        } Last raw content preview: ${lastRawContent.slice(0, 200)}`,
      );
      throw new BadGatewayException(
        `Evaluator failed to produce valid JSON after ${MAX_COMPARE_ATTEMPTS} attempts.`,
      );
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

    let runId: string | undefined;
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
        })
        .returning({ id: arenaRuns.id });
      runId = row?.id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to persist arena run for user ${user.id}: ${msg}`,
      );
    }

    return { runId, comparison: comparisonWithMetrics, responses };
  }

  /**
   * Streaming counterpart to POST /compare-models. Fans the same
   * question out to N models in parallel and pipes their token
   * deltas to the FE over SSE — each event tagged with the model id
   * so the FE can route to the correct panel.
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

    let evaluatorApiKey: string;
    try {
      evaluatorApiKey = await this.keyResolverService.resolveUserKey(user.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Key resolution failed for user ${user.id}: ${msg}`);
      throw new ServiceUnavailableException(
        `AI gateway key unavailable: ${msg}`,
      );
    }

    let teamId: string | null = null;
    const requested = (body.teamId ?? '').trim();
    if (requested && requested !== 'personal' && requested !== 'null') {
      if (
        !(await this.observabilityService.isUserInTeam(user.id, requested))
      ) {
        throw new BadRequestException(
          'You are not a member of the selected team.',
        );
      }
      teamId = requested;
    }

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

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
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
        let transport;
        try {
          transport = await this.chatTransport.resolve({
            userId: user.id,
            modelIdentifier: model,
            teamId,
          });
          await this.chatTransport.assertManagedBudgetApproved(
            transport,
            user.id,
            { teamId },
          );
          const promptTokens = Math.ceil(safeQuestion.length / 4);
          const estimatedCostUsd = await this.catalogService.estimateCost(
            model,
            promptTokens,
            4096,
          );
          const estimatedCostCents =
            estimatedCostUsd != null
              ? Math.ceil(estimatedCostUsd * 100)
              : 0;
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
            model,
            latencyMs: Date.now() - modelStart,
            success: false,
            errorMessage: msg,
            prompt: safeQuestion,
            metadata: { streamed: true },
          });
          return;
        }

        // Stream the model. Reasoning is OFF for arena — arena UI
        // doesn't have a thinking pane, and the per-model panel is
        // already showing the visible answer. Reuses ChatService
        // streaming primitive so there's only one place that
        // maps SDK chunk shapes to ChatStreamEvent.
        let buffer = '';
        let promptTokens: number | undefined;
        let completionTokens: number | undefined;
        let totalTokens: number | undefined;
        let costUsd: number | undefined;
        let modelErrored = false;
        let errorPayload: { message: string; status?: number } | null =
          null;

        try {
          for await (const event of this.chatService.sendMessageStream(
            [{ role: 'user', content: safeQuestion }],
            transport.model,
            false,
            composedContext || undefined,
            transport.apiKey,
            transport.baseURL,
            transport.kind,
            { signal: abortController.signal },
          )) {
            if (event.type === 'content') {
              buffer += event.delta;
              sendEvent('model-delta', { model, text: event.delta });
            } else if (event.type === 'usage') {
              promptTokens = event.promptTokens;
              completionTokens = event.completionTokens;
              totalTokens = event.totalTokens;
              costUsd = event.costUsd;
            } else if (event.type === 'error') {
              modelErrored = true;
              errorPayload = {
                message: event.message,
                status: event.status,
              };
              break;
            }
            // `reasoning` events ignored — arena UI doesn't render
            // thinking text.
          }
        } catch (err) {
          modelErrored = true;
          errorPayload = {
            message: err instanceof Error ? err.message : String(err),
          };
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
            model,
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
            model,
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
            model,
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
    if (responses.length > 0) {
      const EVALUATOR_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';
      let lastParseError: string | undefined;
      let lastRawContent = '';

      for (let attempt = 1; attempt <= MAX_COMPARE_ATTEMPTS; attempt++) {
        const evalStart = Date.now();
        try {
          const comparison =
            await this.compareModelsService.compareModelAnswers(
              responses,
              body.expectedOutput,
              EVALUATOR_MODEL,
              false,
              evaluatorApiKey,
            );
          void this.observabilityService.recordLLMCall({
            userId: user.id,
            teamId,
            eventType: 'evaluator_call',
            model: EVALUATOR_MODEL,
            latencyMs: Date.now() - evalStart,
            success: true,
            metadata: { attempt, streamed: true },
          });
          lastRawContent = comparison.content ?? '';
          try {
            comparisonItems = this.parseComparisonContent(lastRawContent);
          } catch (err) {
            lastParseError =
              err instanceof Error ? err.message : String(err);
            comparisonItems = [];
          }
          if (comparisonItems.length > 0) break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          void this.observabilityService.recordLLMCall({
            userId: user.id,
            teamId,
            eventType: 'evaluator_call',
            model: EVALUATOR_MODEL,
            latencyMs: Date.now() - evalStart,
            success: false,
            errorMessage: msg,
            metadata: { attempt, streamed: true },
          });
          this.logger.error(
            `Evaluator call failed on attempt ${attempt}/${MAX_COMPARE_ATTEMPTS}: ${msg}`,
          );
          break;
        }
      }

      if (comparisonItems.length === 0 && lastParseError) {
        this.logger.warn(
          `Evaluator returned unparseable output after ${MAX_COMPARE_ATTEMPTS} attempts (${lastParseError}). Raw: ${lastRawContent.slice(0, 200)}`,
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
      });
      sendEvent('done', {});
      res.end();
    }
  }

  @Get('runs')
  async listRuns(@CurrentUser() user: AuthenticatedUser) {
    const rows = await this.db
      .select({
        id: arenaRuns.id,
        question: arenaRuns.question,
        createdAt: arenaRuns.createdAt,
      })
      .from(arenaRuns)
      .where(eq(arenaRuns.userId, user.id))
      .orderBy(desc(arenaRuns.createdAt))
      .limit(50);

    return rows;
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
      createdAt: row.createdAt,
    };
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
    @CurrentUser() user: AuthenticatedUser,
    @Body('teamId') rawTeamId?: string,
  ): Promise<{ name: string; content: string }> {
    if (!file) {
      throw new BadRequestException('No file was uploaded.');
    }

    // Mirror the /compare-models scoping rule: Personal by default; an
    // explicit teamId from the composer is honored after membership check.
    // Without this, OCR events would always be tagged with the user's
    // primary team and misattributed when the composer is set to Personal
    // or another team.
    let teamId: string | null = null;
    const requested = (rawTeamId ?? '').trim();
    if (requested && requested !== 'personal' && requested !== 'null') {
      if (!(await this.observabilityService.isUserInTeam(user.id, requested))) {
        throw new BadRequestException(
          'You are not a member of the selected team.',
        );
      }
      teamId = requested;
    }

    const mimetype = file.mimetype;
    const name = file.originalname;
    const lowerName = name.toLowerCase();

    let content: string;

    if (IMAGE_MIMETYPES.has(mimetype)) {
      let apiKey: string;
      try {
        apiKey = await this.keyResolverService.resolveUserKey(user.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ServiceUnavailableException(
          `AI gateway key unavailable for OCR: ${msg}`,
        );
      }

      const dataUrl = `data:${mimetype};base64,${file.buffer.toString('base64')}`;
      let extracted: string;
      const ocrStart = Date.now();
      try {
        extracted = await this.compareModelsService.extractTextFromImage(
          dataUrl,
          OCR_MODEL,
          apiKey,
        );
        void this.observabilityService.recordLLMCall({
          userId: user.id,
          teamId,
          eventType: 'arena_attachment_ocr',
          model: OCR_MODEL,
          latencyMs: Date.now() - ocrStart,
          success: true,
          metadata: { filename: name, mimetype },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void this.observabilityService.recordLLMCall({
          userId: user.id,
          teamId,
          eventType: 'arena_attachment_ocr',
          model: OCR_MODEL,
          latencyMs: Date.now() - ocrStart,
          success: false,
          errorMessage: msg,
          metadata: { filename: name, mimetype },
        });
        this.logger.error(`OCR failed for "${name}": ${msg}`);
        throw new BadGatewayException(msg);
      }
      content = extracted === 'NO_TEXT_FOUND' ? '' : extracted;
    } else {
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
            dot !== -1 && dot < lowerName.length - 1
              ? lowerName.slice(dot)
              : '';
          const detail = ext
            ? `"${ext}" (${mimetype || 'no MIME type'})`
            : `"${mimetype || 'unknown type'}"`;
          throw new BadRequestException(
            `Unsupported file type ${detail}. Only PDF, DOCX, images (PNG, JPG, JPEG, WebP, GIF), and text-based files (TXT, MD, CSV, JSON, code) are allowed.`,
          );
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to parse attachment "${name}": ${msg}`);
        throw new BadRequestException(`Failed to parse "${name}": ${msg}`);
      }
    }

    if (!content.trim()) {
      throw new BadRequestException(
        `No text could be extracted from "${name}". The file may be scanned, image-only or empty.`,
      );
    }

    return { name, content };
  }
}
