import {
  Body,
  Controller,
  HttpException,
  Inject,
  Logger,
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
import { resolveWebSearchCapability } from '../integrations/web-search-capability.resolver.js';
import { KnowledgeIngestionService } from '../knowledge-core/knowledge-ingestion.service.js';
import { OpenRouterCatalogService } from '../models/openrouter-catalog.service.js';
import { ObservabilityService } from '../observability/observability.service.js';
import { ProjectKnowledgeService } from '../projects/project-knowledge.service.js';
import { SkillRouterService } from '../skills/skill-router.service.js';
import { ChatService } from './chat.service.js';
import { ModelSuggestionService } from './model-suggestion.service.js';
import { ChatGateway } from '../realtime/chat.gateway.js';

/** A Knowledge Core file shown inline on the user's message. The file
 *  itself lives in KC (uploaded / linked to the project on the FE before
 *  send); this is just the display + download reference. */
interface ChatAttachment {
  fileId: string;
  name: string;
  fileType?: string | null;
}

interface ChatRequestBody {
  conversationId: string;
  content: string;
  model?: string;
  enableReasoning?: boolean;
  projectId?: string;
  /** KC files attached to THIS message (rendered as chips, downloadable;
   *  their content is fed to RAG via the project attachment path). */
  attachments?: ChatAttachment[];
  /** Skills the user pinned in the composer for this conversation — always
   *  injected, bypassing the router's embedding threshold. */
  pinnedSkillIds?: string[];
}

@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly documentsService: DocumentsService,
    private readonly conversationsService: ConversationsService,
    private readonly chatTransport: ChatTransportService,
    private readonly catalogService: OpenRouterCatalogService,
    private readonly observabilityService: ObservabilityService,
    private readonly guardrails: GuardrailEvaluatorService,
    private readonly knowledgeIngestion: KnowledgeIngestionService,
    private readonly projectKnowledge: ProjectKnowledgeService,
    private readonly modelSuggestions: ModelSuggestionService,
    private readonly chatGateway: ChatGateway,
    private readonly skillRouter: SkillRouterService,
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
      .select({ teamId: projects.teamId, webSearch: projects.webSearch })
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

    // Attachments (if any) ride in the message metadata so the FE can
    // render the file chips inline and offer a download — sanitized to
    // the display fields only (never trust extra client keys).
    const attachments = Array.isArray(body.attachments)
      ? body.attachments
          .filter((a) => a && typeof a.fileId === 'string' && a.fileId)
          .map((a) => ({
            fileId: a.fileId,
            name: typeof a.name === 'string' ? a.name : a.fileId,
            fileType: a.fileType ?? null,
          }))
      : [];
    await this.conversationsService.addMessage(
      body.conversationId,
      'user',
      safePrompt,
      user.id,
      attachments.length > 0 ? { attachments } : undefined,
    );
    // Live sync: tell other members in this conversation a new message
    // landed (senderId = author, so the author's own client skips the
    // redundant refetch — it already shows the message optimistically).
    this.chatGateway.emitMessage(body.conversationId, user.id);
    // Refresh the project's sidebar for members viewing it (new
    // conversation / latest-message ordering).
    this.chatGateway.emitProjectActivity(conversation.projectId);
    const conversationAfterPersist = await this.conversationsService.findOne(
      body.conversationId,
      user.id,
    );

    const requestedModel = body.model ?? 'moonshotai/kimi-k2.5';
    // `transport` / `usedModel` are reassigned once the stream commits to the
    // model that actually answered (the requested one, or a fallback) so all
    // post-stream cost / observability / persistence follows the real model.
    let transport = await this.chatTransport.resolve({
      userId: user.id,
      modelIdentifier: requestedModel,
      projectId: conversation.projectId,
    });
    let usedModel = requestedModel;

    // Effective web search = the project switch AND the OpenRouter route AND
    // the org/team capability. The web plugin is OpenRouter-specific, so it
    // never applies on BYOK / custom OpenAI-compatible routes — gating here
    // keeps both the plugin injection and the budget surcharge off those
    // routes. Short-circuits so the capability lookup (extra queries) only
    // runs when the project wants web search on an OpenRouter model.
    const webSearch =
      !!proj?.webSearch &&
      transport.source === 'openrouter' &&
      (await resolveWebSearchCapability(this.db, user.id, teamId));

    await this.chatTransport.assertManagedBudgetApproved(transport, user.id, {
      projectId: conversation.projectId,
    });

    const promptTokens = Math.ceil(safePrompt.length / 4);
    const estimatedCostUsd = await this.catalogService.estimateCost(
      requestedModel,
      promptTokens,
      4096,
    );
    // Web search adds an OpenRouter surcharge the catalog price doesn't
    // cover. Representative flat estimate = the Exa fallback rate of
    // $0.005/request (up to 10 results); native engines bill provider
    // passthrough which varies, so this is approximate. Folded into the
    // pre-flight budget gate so an enabled project isn't silently
    // under-gated; actual cost is still trued up from usage.cost
    // post-stream.
    const WEB_SEARCH_SURCHARGE_USD = 0.005;
    const estimatedCostCents = Math.ceil(
      ((estimatedCostUsd ?? 0) + (webSearch ? WEB_SEARCH_SURCHARGE_USD : 0)) *
        100,
    );
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
      callerUserId: user.id,
    });

    const apiMessages = conversationAfterPersist.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Embed the user message ONCE and share the vector across every
    // similarity lookup this turn (project docs, attached files, accessible
    // KC chunks — and, later, the skill router). The embedder is local /
    // in-process so this is CPU-only, but a project chat with attachments
    // otherwise embeds the same prompt 3× per turn.
    const [queryEmbedding] = await this.documentsService.embed([safePrompt]);

    const contextChunks: string[] = [];
    if (body.projectId) {
      // Project-scoped paste-text snippets (legacy + still active).
      const relevant = await this.documentsService.searchRelevant(
        body.projectId,
        safePrompt,
        5,
        queryEmbedding,
      );
      for (const doc of relevant) contextChunks.push(doc.content);

      // KC files explicitly attached to the project — separate from
      // the user-wide `searchAccessibleChunks` below to keep the
      // attached-file path narrowly scoped. Visibility scopes still
      // apply (the inner service enforces them per chunk), so an
      // 'admins'-only file remains admins-only even when attached.
      // Resolve attached ids first; if none, skip the embedding
      // round-trip. Files attached to THIS message are injected in full
      // below (direct path), so drop them here to avoid the same content
      // landing in the context twice.
      const thisMsgAttachmentIds = new Set(attachments.map((a) => a.fileId));
      const attachedFileIds = (
        await this.projectKnowledge.getAttachedFileIds(body.projectId)
      ).filter((id) => !thisMsgAttachmentIds.has(id));
      if (attachedFileIds.length > 0) {
        const attachedChunks =
          await this.knowledgeIngestion.searchProjectAttachedChunks(
            user.id,
            attachedFileIds,
            safePrompt,
            5,
            queryEmbedding,
          );
        for (const chunk of attachedChunks) contextChunks.push(chunk.content);
      }
    }
    const userKnowledge = await this.knowledgeIngestion.searchAccessibleChunks(
      user.id,
      safePrompt,
      5,
      queryEmbedding,
    );
    for (const chunk of userKnowledge) contextChunks.push(chunk.content);

    // Files attached to THIS message get their full text injected
    // directly (not semantic-gated, and parsed from disk if async
    // ingestion hasn't finished) so the model always sees what the user
    // just attached — like ChatGPT. Prepended so it leads the context.
    if (attachments.length > 0) {
      const attachedTexts =
        await this.knowledgeIngestion.getOwnedAttachedFilesText(
          user.id,
          attachments.map((a) => a.fileId),
        );
      for (let i = attachedTexts.length - 1; i >= 0; i--) {
        const f = attachedTexts[i];
        contextChunks.unshift(`Attached file "${f.name}":\n${f.text}`);
      }
    }

    // Skills: the router picks 0–N relevant skills (sticky for this
    // conversation + pinned + freshly matched) and we prepend their
    // instructions so they lead the context. Reuses the per-turn query
    // vector — no extra embed. Failures here must not break chat, so the
    // whole step is best-effort.
    let appliedSkills: { id: string; name: string }[] = [];
    try {
      const selected = await this.skillRouter.selectForMessage({
        userId: user.id,
        queryEmbedding,
        messageText: safePrompt,
        conversationId: body.conversationId,
        projectId: body.projectId,
        pinnedSkillIds: body.pinnedSkillIds,
      });
      if (selected.length > 0) {
        contextChunks.unshift(this.skillRouter.renderContextBlock(selected));
        appliedSkills = selected.map((s) => ({ id: s.id, name: s.name }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Skill selection failed; continuing without skills: ${msg}`,
      );
    }

    const context =
      contextChunks.length > 0 ? contextChunks.join('\n\n---\n\n') : undefined;

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
    let citationsCollected: { url: string; title?: string }[] = [];
    let streamErrored = false;
    let streamErrorPayload: { message: string; status?: number } | null = null;
    let blockedDuringStream = false;

    // Model attempt list: the requested model first, then its configured
    // fallbacks (in order). When a candidate fails with a retryable error
    // (dead/unavailable model — "no endpoints found", 404, provider 5xx)
    // BEFORE any token reaches the client, switch transparently to the next
    // candidate. `usedModel` / `usedTransport` capture the one that actually
    // produced the stream so cost / observability / persistence reflect it.
    const fallbackModels = await this.chatTransport.resolveFallbackModels({
      userId: user.id,
      modelIdentifier: requestedModel,
      projectId: conversation.projectId,
      teamId,
    });
    const candidates = [requestedModel, ...fallbackModels];
    // If a candidate emits no first token within this window AND a fallback
    // exists, treat it like a dead model and switch. Matches the Models-tab
    // promise ("timeouts (3s) or returns error").
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
    let usedTransport = transport;
    // Capture the services as locals so the generator below doesn't have to
    // alias `this` (and trip @typescript-eslint/no-this-alias).
    const chatService = this.chatService;
    const chatTransport = this.chatTransport;
    const catalogService = this.catalogService;
    async function* streamWithFallback() {
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        // Reuse the primary transport (already resolved + budget-approved);
        // re-resolve + re-gate for fallbacks (they may route differently).
        let t = transport;
        if (i > 0) {
          t = await chatTransport.resolve({
            userId: user.id,
            modelIdentifier: candidate,
            projectId: conversation.projectId,
          });
          await chatTransport.assertManagedBudgetApproved(t, user.id, {
            projectId: conversation.projectId,
          });
          // Re-run the spend gates for the fallback: its cost may differ from
          // the requested model's pre-flight estimate, and a fallback must not
          // bypass the team-member-cap / team / org budget limits.
          const fbWebSearch = webSearch && t.source === 'openrouter';
          const fbEstUsd = await catalogService.estimateCost(
            candidate,
            promptTokens,
            4096,
          );
          const fbEstCents = Math.ceil(
            ((fbEstUsd ?? 0) + (fbWebSearch ? WEB_SEARCH_SURCHARGE_USD : 0)) *
              100,
          );
          await chatTransport.assertTeamMemberCapNotExceeded(user.id, {
            projectId: conversation.projectId,
            estimatedCostCents: fbEstCents,
          });
          await chatTransport.assertTeamBudgetNotExceeded({
            projectId: conversation.projectId,
            estimatedCostCents: fbEstCents,
          });
          await chatTransport.assertOrgBudgetNotExceeded({
            estimatedCostCents: fbEstCents,
            callerUserId: user.id,
          });
        }
        // Web search is OpenRouter-specific — re-gate per candidate (uses the
        // final resolved transport for this candidate).
        const candidateWebSearch = webSearch && t.source === 'openrouter';

        // First-token timeout: abort and fall back if no token arrives in
        // time. Only when a fallback exists — the final candidate is left to
        // run so a slow-but-valid model isn't killed with nothing to switch
        // to. A separate AbortController, OR-ed with the client-disconnect
        // signal, so a timeout is distinguishable from a real cancellation.
        const hasNext = i < candidates.length - 1;
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
          for await (const ev of chatService.sendMessageStream(
            apiMessages,
            t.model,
            body.enableReasoning,
            context,
            t.apiKey,
            t.baseURL,
            t.kind,
            {
              signal,
              webSearch: candidateWebSearch,
              azureEndpoint: t.azureEndpoint,
              azureApiVersion: t.azureApiVersion,
            },
          )) {
            // A pre-content error from a dead model → abandon this candidate.
            // Client-disconnect / timeout aborts are handled below, not here.
            if (
              ev.type === 'error' &&
              !producedOutput &&
              !abortController.signal.aborted &&
              !attemptAbort.signal.aborted &&
              !clientDisconnected
            ) {
              attemptError = { message: ev.message, status: ev.status };
              break;
            }
            if (!firstTokenSeen) {
              firstTokenSeen = true;
              if (timer) clearTimeout(timer);
            }
            producedOutput = true;
            usedModel = candidate;
            usedTransport = t;
            yield ev;
          }
        } finally {
          if (timer) clearTimeout(timer);
        }

        // The attempt's own abort fired (not the client) before any token →
        // the model was too slow; fall back.
        const timedOut =
          !producedOutput &&
          attemptAbort.signal.aborted &&
          !abortController.signal.aborted &&
          !clientDisconnected;

        if (
          !producedOutput &&
          hasNext &&
          (timedOut ||
            (attemptError !== null &&
              isRetryableModelError(attemptError.status, attemptError.message)))
        ) {
          continue; // try the next fallback
        }
        if (attemptError && !producedOutput) {
          // Last candidate / non-retryable: surface so the loop maps it to
          // an `error` SSE.
          usedModel = candidate;
          usedTransport = t;
          yield {
            type: 'error' as const,
            message: attemptError.message,
            status: attemptError.status,
          };
        }
        return;
      }
    }

    try {
      for await (const event of streamWithFallback()) {
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
        } else if (event.type === 'citations') {
          citationsCollected = event.citations;
          sendEvent('citations', { citations: event.citations });
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

    // Point `transport` at whatever model actually answered (the requested
    // one or a fallback) so all the cost / observability / persistence below
    // reports the real route, not the originally-requested one.
    transport = usedTransport;

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
        model: usedModel,
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
        model: usedModel,
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
        model: usedModel,
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
        usedModel,
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
    if (citationsCollected.length > 0) metadata.citations = citationsCollected;
    if (clientDisconnected) metadata.partial = true;
    // Record which model actually answered so the FE can show it (and flag a
    // fallback when it differs from the requested model) on reload.
    metadata.model = usedModel;
    if (usedModel !== requestedModel) metadata.requestedModel = requestedModel;
    // Record which skills the router applied so the FE can show a
    // "Skill applied" chip and the user understands why the style shifted.
    if (appliedSkills.length > 0) metadata.skills = appliedSkills;

    await this.conversationsService.addMessage(
      body.conversationId,
      'assistant',
      finalText,
      null,
      Object.keys(metadata).length > 0 ? metadata : undefined,
    );
    // Live sync the assistant reply to other members. senderId is the
    // triggering user so their own client (which streamed the reply)
    // skips the refetch; everyone else in the room refetches to see it.
    this.chatGateway.emitMessage(body.conversationId, user.id);
    this.chatGateway.emitProjectActivity(conversation.projectId);

    void this.observabilityService.recordLLMCall({
      userId: user.id,
      teamId,
      eventType: 'chat_call',
      model: usedModel,
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
        skillsApplied: appliedSkills.length || undefined,
      },
    });

    if (!res.writableEnded) {
      // Optional follow-up suggestion. Only fires when a static rule
      // matches AND the user wasn't stopped mid-stream — sending a
      // suggestion for an aborted turn would be confusing UX. The
      // field is purely additive on the SSE shape; older FE builds
      // that don't read it just ignore it.
      const alternativeModel = clientDisconnected
        ? null
        : this.modelSuggestions.suggest({
            prompt: safePrompt,
            currentModel: body.model ?? '',
          });

      sendEvent('done', {
        totalTokens: usageTotalTokens,
        costUsd,
        partial: clientDisconnected ? true : undefined,
        alternativeModel: alternativeModel ?? undefined,
        // The model that actually answered + the originally-requested one, so
        // the FE can surface "answered by <fallback>" when they differ.
        model: usedModel,
        requestedModel,
      });
      res.end();
    }
  }
}
