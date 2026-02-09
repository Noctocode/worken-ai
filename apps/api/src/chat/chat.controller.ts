import { Body, Controller, Post } from '@nestjs/common';
import { ChatService } from './chat.service';
import { DocumentsService } from '../documents/documents.service';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning_details?: unknown;
}

interface ChatRequestBody {
  messages: ChatMessage[];
  model?: string;
  enableReasoning?: boolean;
  projectId?: string;
}

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly documentsService: DocumentsService,
  ) {}

  @Post()
  async chat(@Body() body: ChatRequestBody) {
    let context: string | undefined;

    if (body.projectId && body.messages.length > 0) {
      const lastUserMessage = [...body.messages]
        .reverse()
        .find((m) => m.role === 'user');

      if (lastUserMessage) {
        const relevant = await this.documentsService.searchRelevant(
          body.projectId,
          lastUserMessage.content,
        );

        if (relevant.length > 0) {
          context = relevant.map((doc) => doc.content).join('\n\n---\n\n');
        }
      }
    }

    const response = await this.chatService.sendMessage(
      body.messages,
      body.model,
      body.enableReasoning,
      context,
    );

    return {
      role: 'assistant',
      content: response.content,
      ...(response.reasoning_details ? { reasoning_details: response.reasoning_details } : {}),
    };
  }
}
