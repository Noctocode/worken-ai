import { Body, Controller, HttpException, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { ObservabilityService } from '../observability/observability.service.js';
import { KeyResolverService } from '../openrouter/key-resolver.service.js';
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
    private readonly keyResolverService: KeyResolverService,
    private readonly observabilityService: ObservabilityService,
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

    // Resolve per-team or per-user API key
    const apiKey = await this.keyResolverService.resolveForProject(
      conversation.projectId,
      user.id,
    );

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
    const teamId = await this.observabilityService.getPrimaryTeamId(user.id);
    const chatStart = Date.now();
    let response;
    try {
      response = await this.chatService.sendMessage(
        apiMessages,
        body.model,
        body.enableReasoning,
        context,
        apiKey,
      );
      void this.observabilityService.recordLLMCall({
        userId: user.id,
        teamId,
        eventType: 'chat_call',
        model: body.model ?? 'moonshotai/kimi-k2.5',
        totalTokens: response.totalTokens,
        costUsd: response.totalCost,
        latencyMs: Date.now() - chatStart,
        success: true,
        prompt: body.content,
        metadata: {
          conversationId: body.conversationId,
          projectId: body.projectId ?? null,
          hasContext: Boolean(context),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void this.observabilityService.recordLLMCall({
        userId: user.id,
        teamId,
        eventType: 'chat_call',
        model: body.model ?? 'moonshotai/kimi-k2.5',
        latencyMs: Date.now() - chatStart,
        success: false,
        errorMessage: msg,
        prompt: body.content,
        metadata: {
          conversationId: body.conversationId,
          projectId: body.projectId ?? null,
        },
      });

      // Surface OpenRouter HTTP status codes (402/401/429/…) to the
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
        const detail =
          apiErr.error?.message ??
          apiErr.message ??
          `OpenRouter error ${apiErr.status}`;
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
