import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { DocumentsService } from '../documents/documents.service.js';
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

    // 5. Call the chat service
    const response = await this.chatService.sendMessage(
      apiMessages,
      body.model,
      body.enableReasoning,
      context,
    );

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
