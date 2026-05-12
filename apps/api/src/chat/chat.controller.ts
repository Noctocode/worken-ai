import {
  Body,
  Controller,
  HttpException,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { projects } from '@worken/database/schema';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { DocumentsService } from '../documents/documents.service.js';
import {
  GUARDRAIL_BLOCKED_MARKER,
  GuardrailEvaluatorService,
  STREAM_REEVAL_CHUNK_BYTES,
} from '../guardrails/guardrail-evaluator.service.js';
import { ChatTransportService } from '../integrations/chat-transport.service.js';
import { KnowledgeIngestionService } from '../knowledge-core/knowledge-ingestion.service.js';
import { OpenRouterCatalogService } from '../models/openrouter-catalog.service.js';
import { ObservabilityService } from '../observability/observability.service.js';
import { ChatService } from './chat.service.js';

interface ChatRequestBody {
  conversationId: string;
  content: string;
  model?: string;
  enableReasoning?: boolean;
  projectId?: string;
}

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly documentsService: DocumentsService,
    private readonly conversationsService: ConversationsService,
    private readonly chatTransport: ChatTransportService,
    private readonly catalogService: OpenRouterCatalogService,
    private readonly observabilityService: ObservabilityService,
    private readonly guardrails: GuardrailEvaluatorService,
    private readonly knowledgeIngestion: KnowledgeIngestionService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}


  /**
   * Token-streaming chat endpoint. Returns text/event-stream so the
   * FE renders tokens as they arrive. Pre-flight (auth, conversation
   * load, guardrail INPUT, persist user msg, transport resolve,
   * budget gates, RAG) runs BEFORE SSE headers are flushed — so any
   * failure there still comes back as a regular JSON 4xx the FE
   * humanizer can route.
   *
   * Event shapes (data is JSON-encoded except where noted):
   *   - `delta`     {text}            visible token piece, append
   *   - `reasoning` {text}            model "thinking" piece
   *   - `replace`   {text}            full assistant text replaces
   *                                   anything streamed so far. Fires
   *                                   once at end if the final output
   *                                   guardrail redacted via fix-rule.
   *   - `blocked`   {rule,validator}  output guardrail BLOCK fired;
   *                                   stream closes immediately, no
   *                                   assistant message persisted.
   *   - `error`     {message,status}  upstream provider error
   *                                   (4xx/5xx). Stream closes.
   *   - `done`      {totalTokens,costUsd,partial?}  final summary
   *                                   after persistence + observability.
   *
   * Cancellation: a FE disconnect (Stop button → reader.cancel())
   * fires `req.on('close')` here, which aborts the upstream SDK
   * call. Whatever content was buffered up to that point is
   * persisted with `metadata.partial = true` so the conversation
   * remains navigable and the user sees what they got.
   */
  @Post('stream')
  async chatStream(
    @Body() body: ChatRequestBody,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // ── PRE-FLIGHT (mirrors POST /chat) ─────────────────────────────
    const conversation = await this.conversationsService.findOne(
      body.conversationId,
      user.id,
    );

    const [proj] = await this.db
      .select({ teamId: projects.teamId })
      .from(projects)
      .where(eq(projects.id, conversation.projectId))
      .limit(1);
    const teamId = proj?.teamId ?? null;

    const inputDecision = await this.guardrails.evaluate({
      text: body.content,
      target: 'input',
      userId: user.id,
      teamId,
    });
    if (inputDecision.blocked) {
      throw new HttpException(
        `${GUARDRAIL_BLOCKED_MARKER}: "${inputDecision.blocked.ruleName}" blocked your message (${inputDecision.blocked.validator}). Edit the prompt and try again, or ask an admin to adjust the rule in Management → Guardrails.`,
        422,
      );
    }
    const safePrompt = inputDecision.text;

    await this.conversationsService.addMessage(
      body.conversationId,
      'user',
      safePrompt,
      user.id,
    );
    const conversationAfterPersist = await this.conversationsService.findOne(
      body.conversationId,
      user.id,
    );

    const transport = await this.chatTransport.resolve({
      userId: user.id,
      modelIdentifier: body.model ?? 'moonshotai/kimi-k2.5',
      projectId: conversation.projectId,
    });

    await this.chatTransport.assertManagedBudgetApproved(transport, user.id, {
      projectId: conversation.projectId,
    });

    const promptTokens = Math.ceil(safePrompt.length / 4);
    const estimatedCostUsd = await this.catalogService.estimateCost(
      body.model ?? 'moonshotai/kimi-k2.5',
      promptTokens,
      4096,
    );
    const estimatedCostCents =
      estimatedCostUsd != null ? Math.ceil(estimatedCostUsd * 100) : 0;
    await this.chatTransport.assertTeamMemberCapNotExceeded(user.id, {
      projectId: conversation.projectId,
      estimatedCostCents,
    });
    await this.chatTransport.assertTeamBudgetNotExceeded({
      projectId: conversation.projectId,
      estimatedCostCents,
    });
    await this.chatTransport.assertOrgBudgetNotExceeded({
      estimatedCostCents,
    });

    const apiMessages = conversationAfterPersist.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const contextChunks: string[] = [];
    if (body.projectId) {
      const relevant = await this.documentsService.searchRelevant(
        body.projectId,
        safePrompt,
      );
      for (const doc of relevant) contextChunks.push(doc.content);
    }
    const userKnowledge =
      await this.knowledgeIngestion.searchAccessibleChunks(
        user.id,
        safePrompt,
      );
    for (const chunk of userKnowledge) contextChunks.push(chunk.content);
    const context =
      contextChunks.length > 0
        ? contextChunks.join('\n\n---\n\n')
        : undefined;

    // ── SSE HEADERS — past this point, everything is an SSE event ───
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Some reverse proxies (nginx default) buffer responses, which
    // breaks token-by-token rendering. This hint tells them not to.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Single write per SSE frame: two separate writes can interleave
    // when multiple async paths share `res` (true for the arena
    // controller, harmless single-stream here but kept consistent).
    // Guard against post-disconnect writes — `req.on('close')` fires
    // while the loop may still be mid-iteration, and a stale
    // sendEvent would throw EPIPE / write-after-end and crash the
    // handler. writableEnded covers our own res.end(); destroyed
    // covers the socket-closed-by-client case.
    const sendEvent = (event: string, data: unknown) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // AbortController bound to FE disconnect (Stop button → fetch
    // reader.cancel() → req.close). The upstream SDK receives the
    // signal and aborts the HTTP call to the provider — bytes
    // already in flight still arrive (usage event etc.), but no
    // further generation is billed.
    const abortController = new AbortController();
    let clientDisconnected = false;
    req.on('close', () => {
      if (!res.writableEnded) {
        clientDisconnected = true;
        abortController.abort();
      }
    });

    // ── STREAM LOOP ─────────────────────────────────────────────────
    const chatStart = Date.now();
    let pending = ''; // full accumulated assistant text so far
    let reasoningText = '';
    let bytesSinceEval = 0;
    let usagePromptTokens: number | undefined;
    let usageCompletionTokens: number | undefined;
    let usageTotalTokens: number | undefined;
    let usageCostUsd: number | undefined;
    let streamErrored = false;
    let streamErrorPayload: { message: string; status?: number } | null =
      null;
    let blockedDuringStream = false;

    try {
      for await (const event of this.chatService.sendMessageStream(
        apiMessages,
        transport.model,
        body.enableReasoning,
        context,
        transport.apiKey,
        transport.baseURL,
        transport.kind,
        { signal: abortController.signal },
      )) {
        if (event.type === 'content') {
          pending += event.delta;
          bytesSinceEval += Buffer.byteLength(event.delta, 'utf8');
          sendEvent('delta', { text: event.delta });

          // Blocking-only incremental output guardrail. Fix-rules
          // run only on the final pass (after stream close) per
          // the design decision — keeps the UX stable and the BE
          // branch logic simpler. A blocking violation closes the
          // stream + skips persistence.
          if (bytesSinceEval >= STREAM_REEVAL_CHUNK_BYTES) {
            const decision = await this.guardrails.evaluate({
              text: pending,
              target: 'output',
              userId: user.id,
              teamId,
            });
            if (decision.blocked) {
              blockedDuringStream = true;
              sendEvent('blocked', {
                rule: decision.blocked.ruleName,
                validator: decision.blocked.validator,
              });
              abortController.abort();
              break;
            }
            bytesSinceEval = 0;
          }
        } else if (event.type === 'reasoning') {
          reasoningText += event.delta;
          sendEvent('reasoning', { text: event.delta });
        } else if (event.type === 'usage') {
          usagePromptTokens = event.promptTokens;
          usageCompletionTokens = event.completionTokens;
          usageTotalTokens = event.totalTokens;
          usageCostUsd = event.costUsd;
        } else if (event.type === 'error') {
          // If the upstream error landed because the client
          // disconnected (some SDKs surface AbortSignal as an
          // error event even after we try to detect it in
          // chat.service), treat it as a clean cancellation
          // instead of a hard failure. Fall through to the
          // post-loop persistence path so the buffered content
          // gets saved with metadata.partial = true.
          if (clientDisconnected || abortController.signal.aborted) {
            break;
          }
          streamErrored = true;
          streamErrorPayload = {
            message: event.message,
            status: event.status,
          };
          sendEvent('error', streamErrorPayload);
          break;
        }
      }
    } catch (err) {
      // sendMessageStream itself surfaces upstream errors as
      // `error` events, so reaching here means something inside the
      // event loop above threw (e.g. guardrail eval DB blip). Map
      // it to one final error SSE so the FE doesn't hang.
      streamErrored = true;
      const message = err instanceof Error ? err.message : String(err);
      streamErrorPayload = { message };
      if (!res.writableEnded) sendEvent('error', streamErrorPayload);
    }

    // ── POST-STREAM: final guardrail + persistence + observability ──
    const latencyMs = Date.now() - chatStart;

    if (blockedDuringStream) {
      // Observability: count the blocked attempt; don't persist the
      // assistant message (intentional — blocked output never lands
      // in conversation history).
      void this.observabilityService.recordLLMCall({
        userId: user.id,
        teamId,
        eventType: 'chat_call',
        model: body.model ?? 'moonshotai/kimi-k2.5',
        provider: transport.provider,
        totalTokens: usageTotalTokens,
        costUsd: usageCostUsd ?? null,
        latencyMs,
        success: false,
        errorMessage: 'Output guardrail blocked mid-stream',
        prompt: safePrompt,
        metadata: {
          conversationId: body.conversationId,
          projectId: body.projectId ?? null,
          hasContext: Boolean(context),
          routingSource: transport.source,
          streamed: true,
        },
      });
      if (!res.writableEnded) res.end();
      return;
    }

    if (streamErrored) {
      void this.observabilityService.recordLLMCall({
        userId: user.id,
        teamId,
        eventType: 'chat_call',
        model: body.model ?? 'moonshotai/kimi-k2.5',
        provider: transport.provider,
        latencyMs,
        success: false,
        errorMessage: streamErrorPayload?.message ?? 'Stream error',
        prompt: safePrompt,
        metadata: {
          conversationId: body.conversationId,
          projectId: body.projectId ?? null,
          routingSource: transport.source,
          streamed: true,
        },
      });
      if (!res.writableEnded) res.end();
      return;
    }

    // Final full-text output guardrail. Catches BLOCK rules whose
    // trigger phrase straddled chunk boundaries (incremental evals
    // saw only partial text), and applies fix-rule redactions ONCE
    // here so the FE shows the cleaned version after the stream
    // settles.
    const finalDecision = await this.guardrails.evaluate({
      text: pending,
      target: 'output',
      userId: user.id,
      teamId,
    });
    if (finalDecision.blocked) {
      sendEvent('blocked', {
        rule: finalDecision.blocked.ruleName,
        validator: finalDecision.blocked.validator,
      });
      void this.observabilityService.recordLLMCall({
        userId: user.id,
        teamId,
        eventType: 'chat_call',
        model: body.model ?? 'moonshotai/kimi-k2.5',
        provider: transport.provider,
        totalTokens: usageTotalTokens,
        costUsd: usageCostUsd ?? null,
        latencyMs,
        success: false,
        errorMessage: 'Output guardrail blocked on final pass',
        prompt: safePrompt,
        metadata: {
          conversationId: body.conversationId,
          projectId: body.projectId ?? null,
          hasContext: Boolean(context),
          routingSource: transport.source,
          streamed: true,
        },
      });
      if (!res.writableEnded) res.end();
      return;
    }
    const finalText = finalDecision.text;
    if (finalText !== pending) {
      // Fix-rule redaction fired on the final pass — overwrite the
      // assistant message client-side. The text shown so far might
      // contain PII; this swap is what makes it disappear.
      sendEvent('replace', { text: finalText });
    }

    // Cost backfill for non-OpenRouter routes — same logic as the
    // non-stream controller. OpenRouter gives `cost` in the usage
    // event; Anthropic/BYOK paths estimate from the catalog.
    let costUsd = usageCostUsd ?? null;
    let costEstimated = false;
    if (
      costUsd == null &&
      transport.source !== 'openrouter' &&
      usagePromptTokens != null &&
      usageCompletionTokens != null
    ) {
      const estimated = await this.catalogService.estimateCost(
        body.model ?? 'moonshotai/kimi-k2.5',
        usagePromptTokens,
        usageCompletionTokens,
      );
      if (estimated != null) {
        costUsd = estimated;
        costEstimated = true;
      }
    }

    // Persist the assistant message. Partial flag tracks user-
    // initiated cancellation so the FE / future replay can render
    // a "stopped early" badge without re-running the LLM.
    const metadata: Record<string, unknown> = {};
    if (reasoningText) metadata.reasoning_details = reasoningText;
    if (clientDisconnected) metadata.partial = true;

    await this.conversationsService.addMessage(
      body.conversationId,
      'assistant',
      finalText,
      null,
      Object.keys(metadata).length > 0 ? metadata : undefined,
    );

    void this.observabilityService.recordLLMCall({
      userId: user.id,
      teamId,
      eventType: 'chat_call',
      model: body.model ?? 'moonshotai/kimi-k2.5',
      provider: transport.provider,
      totalTokens: usageTotalTokens,
      costUsd,
      latencyMs,
      success: true,
      prompt: safePrompt,
      metadata: {
        conversationId: body.conversationId,
        projectId: body.projectId ?? null,
        hasContext: Boolean(context),
        routingSource: transport.source,
        costEstimated,
        streamed: true,
        partial: clientDisconnected ? true : undefined,
      },
    });

    if (!res.writableEnded) {
      sendEvent('done', {
        totalTokens: usageTotalTokens,
        costUsd,
        partial: clientDisconnected ? true : undefined,
      });
      res.end();
    }
  }
}
