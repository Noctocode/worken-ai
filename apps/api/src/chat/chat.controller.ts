import { Body, Controller, Post } from '@nestjs/common';
import { ChatService } from './chat.service';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning_details?: unknown;
}

interface ChatRequestBody {
  messages: ChatMessage[];
  model?: string;
  enableReasoning?: boolean;
}

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  async chat(@Body() body: ChatRequestBody) {
    const response = await this.chatService.sendMessage(
      body.messages,
      body.model,
      body.enableReasoning,
    );

    return {
      role: 'assistant',
      content: response.content,
      ...(response.reasoning_details ? { reasoning_details: response.reasoning_details } : {}),
    };
  }
}
