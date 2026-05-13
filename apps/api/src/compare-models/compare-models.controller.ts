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

    // Arena is Personal-only — every run bills against
    // `user.monthlyBudgetCents`. Team scoping was removed: callers
    // can no longer attribute spend to a team here.
    const teamId: string | null = null;

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
    let evaluatorError: string | null = null;
    if (responses.length > 0) {
      const EVALUATOR_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';
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
            model: EVALUATOR_MODEL,
            latencyMs: Date.now() - evalStart,
            success: false,
            errorMessage: msg,
            metadata: { attempt, streamed: true },
          });
          this.logger.error(
            `Evaluator call failed on attempt ${attempt}/${MAX_COMPARE_ATTEMPTS}: ${msg}`,
          );
          // Retry — could be a transient :free-tier rate limit. The
          // last error message gets surfaced if every attempt fails.
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
  ): Promise<{ name: string; content: string }> {
    if (!file) {
      throw new BadRequestException('No file was uploaded.');
    }

    // Arena is Personal-only — OCR / parse events are tagged with the
    // user and no team scope. Team attribution was removed alongside
    // the team budget option for arena.
    const teamId: string | null = null;

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
