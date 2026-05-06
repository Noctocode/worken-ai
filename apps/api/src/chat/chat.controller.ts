import { Body, Controller, HttpException, Inject, Post } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { projects } from '@worken/database/schema';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { DocumentsService } from '../documents/documents.service.js';
import { ChatTransportService } from '../integrations/chat-transport.service.js';
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
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  @Post()
  async chat(
    @Body() body: ChatRequestBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // 1. Persist the user message
    await this.conversationsService.addMessage(
      body.conversationId,
      'user',
      body.content,
      user.id,
    );

    // 2. Load full conversation history
    const conversation = await this.conversationsService.findOne(
      body.conversationId,
      user.id,
    );

    // Resolve transport: BYOK / Custom LLM if user configured one for
    // this model, else OpenRouter via the resolved per-team/per-user key.
    const transport = await this.chatTransport.resolve({
      userId: user.id,
      modelIdentifier: body.model ?? 'moonshotai/kimi-k2.5',
      projectId: conversation.projectId,
    });

    // Block calls when the budget-bearing entity (team or user) is
    // managed-cloud with monthlyBudgetCents = 0 — awaiting admin
    // approval. Project-scoped chats gate on the team budget; personal
    // chats gate on the user's budget.
    await this.chatTransport.assertManagedBudgetApproved(transport, user.id, {
      projectId: conversation.projectId,
    });

    // Per-member team cap. Independent from the team-wide budget gate
    // above: a team can have $1000/mo total but each member capped at
    // $20. Fires only when the chat's project belongs to a team and
    // the user has a non-null cap on that team.
    //
    // Pre-flight estimate so the call that would push spend over the
    // cap is blocked before it actually happens, not just after. ~4
    // chars/token is the standard rule of thumb for English-ish text;
    // 4096 completion tokens is a conservative upper bound (most chat
    // models default well below that). estimateCost returns null for
    // models without catalog pricing — those degrade to post-flight
    // only.
    const promptForEstimate = body.content ?? '';
    const promptTokens = Math.ceil(promptForEstimate.length / 4);
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
    // Org-wide budget gate fires last so per-team / per-member caps
    // surface their actionable wording first (those are easier for an
    // admin to fix than the company-level target).
    await this.chatTransport.assertOrgBudgetNotExceeded({
      estimatedCostCents,
    });

    // 3. Map stored messages to OpenRouter format
    const apiMessages = conversation.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // 4. RAG lookup if projectId provided
    let context: string | undefined;

    if (body.projectId) {
      const relevant = await this.documentsService.searchRelevant(
        body.projectId,
        body.content,
      );

      if (relevant.length > 0) {
        context = relevant.map((doc) => doc.content).join('\n\n---\n\n');
      }
    }

    // 5. Call the chat service (with per-call observability)
    //
    // Tag the event with the chat's actual team scope — derived from
    // the project, not the user's "primary" team. The OpenRouter key
    // the spend lands on is the project's team key (or the user key
    // for personal projects), so observability.team_id needs to mirror
    // that or the per-team rollups + per-member cap gate go off course
    // when a user is in multiple teams.
    const [proj] = await this.db
      .select({ teamId: projects.teamId })
      .from(projects)
      .where(eq(projects.id, conversation.projectId))
      .limit(1);
    const teamId = proj?.teamId ?? null;
    const chatStart = Date.now();
    let response;
    try {
      response = await this.chatService.sendMessage(
        apiMessages,
        transport.model,
        body.enableReasoning,
        context,
        transport.apiKey,
        transport.baseURL,
        transport.kind,
      );

      // Cost backfill for non-OpenRouter routes. OpenRouter returns
      // `usage.cost` directly; native (BYOK) and Custom endpoints
      // don't, so observability would otherwise show $0 for those
      // calls. Estimate from the OpenRouter catalog's per-token
      // pricing — assumes native pricing matches OpenRouter's listed
      // prices, which is true for headline providers.
      let costUsd = response.totalCost ?? null;
      let costEstimated = false;
      if (
        costUsd == null &&
        transport.source !== 'openrouter' &&
        response.promptTokens != null &&
        response.completionTokens != null
      ) {
        const estimated = await this.catalogService.estimateCost(
          body.model ?? 'moonshotai/kimi-k2.5',
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
        eventType: 'chat_call',
        model: body.model ?? 'moonshotai/kimi-k2.5',
        provider: transport.provider,
        totalTokens: response.totalTokens,
        costUsd,
        latencyMs: Date.now() - chatStart,
        success: true,
        prompt: body.content,
        metadata: {
          conversationId: body.conversationId,
          projectId: body.projectId ?? null,
          hasContext: Boolean(context),
          routingSource: transport.source,
          costEstimated,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void this.observabilityService.recordLLMCall({
        userId: user.id,
        teamId,
        eventType: 'chat_call',
        model: body.model ?? 'moonshotai/kimi-k2.5',
        provider: transport.provider,
        latencyMs: Date.now() - chatStart,
        success: false,
        errorMessage: msg,
        prompt: body.content,
        metadata: {
          conversationId: body.conversationId,
          projectId: body.projectId ?? null,
          routingSource: transport.source,
        },
      });

      // Surface upstream HTTP status codes (402/401/429/…) to the
      // client so the FE humanizer can route them to a specific message.
      // The OpenAI SDK throws errors with a numeric `status` field;
      // everything else falls through as 500.
      if (
        err &&
        typeof err === 'object' &&
        'status' in err &&
        typeof (err as { status: unknown }).status === 'number'
      ) {
        const apiErr = err as {
          status: number;
          message?: string;
          error?: { message?: string };
        };
        const upstreamMessage = apiErr.error?.message ?? apiErr.message ?? '';

        // 401 + no-auth placeholder = user registered a Custom LLM
        // without an API key but the endpoint requires one. Surface a
        // distinct message so the humanizer doesn't say "your key is
        // invalid" (the user has no key).
        const noAuthAttempt =
          transport.apiKey === 'no-auth' && apiErr.status === 401;
        const detail = noAuthAttempt
          ? `Custom LLM endpoint rejected the request — it requires an API key. Open Management → Integration → ${transport.provider}, click Settings, and add your key.`
          : upstreamMessage || `${transport.provider} error ${apiErr.status}`;
        throw new HttpException(detail, apiErr.status);
      }
      throw err;
    }

    // 6. Persist assistant response
    const metadata = response.reasoning_details
      ? { reasoning_details: response.reasoning_details }
      : undefined;

    await this.conversationsService.addMessage(
      body.conversationId,
      'assistant',
      response.content,
      null,
      metadata,
    );

    // 7. Return assistant message
    return {
      role: 'assistant',
      content: response.content,
      ...(response.reasoning_details
        ? { reasoning_details: response.reasoning_details }
        : {}),
    };
  }
}
