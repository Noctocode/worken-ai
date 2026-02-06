import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning_details?: unknown;
}

interface ChatResponse {
  content: string;
  reasoning_details?: unknown;
}

@Injectable()
export class ChatService {
  private client: OpenAI;

  constructor(private configService: ConfigService) {
    this.client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: this.configService.get<string>('OPENROUTER_API_KEY'),
      defaultHeaders: {
        'HTTP-Referer': this.configService.get<string>('SITE_URL') || '',
        'X-Title': this.configService.get<string>('SITE_NAME') || 'WorkenAI',
      },
    });
  }

  async sendMessage(
    messages: ChatMessage[],
    model: string = 'moonshotai/kimi-k2.5',
    enableReasoning: boolean = true,
  ): Promise<ChatResponse> {
    const completion = await this.client.chat.completions.create({
      model,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        ...(msg.reasoning_details ? { reasoning_details: msg.reasoning_details } : {}),
      })),
      ...(enableReasoning && { reasoning: { enabled: true } }),
    });

    // Extract response with reasoning_details
    type ORChatMessage = (typeof completion)['choices'][number]['message'] & {
      reasoning_details?: unknown;
    };
    const response = completion.choices[0].message as ORChatMessage;

    return {
      content: response.content || '',
      ...(response.reasoning_details ? { reasoning_details: response.reasoning_details } : {}),
    };
  }
}
