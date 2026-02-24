import { Injectable } from '@nestjs/common';
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
  private makeClient(apiKey?: string): OpenAI {
    return new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: apiKey ?? process.env['OPENROUTER_API_KEY'],
      defaultHeaders: {
        'HTTP-Referer': process.env['SITE_URL'] || '',
        'X-Title': process.env['SITE_NAME'] || 'WorkenAI',
      },
    });
  }

  async sendMessage(
    messages: ChatMessage[],
    model: string = 'moonshotai/kimi-k2.5',
    enableReasoning: boolean = true,
    context?: string,
    apiKey?: string,
  ): Promise<ChatResponse> {
    const systemMessages: { role: 'system'; content: string }[] = [];
    if (context) {
      systemMessages.push({
        role: 'system',
        content:
          'Use the following project context to inform your answers. Reference this information when relevant.\n\n' +
          context,
      });
    }

    const completion = await this.makeClient(apiKey).chat.completions.create({
      model,
      messages: [
        ...systemMessages,
        ...messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
          ...(msg.reasoning_details
            ? { reasoning_details: msg.reasoning_details }
            : {}),
        })),
      ],
      ...(enableReasoning && { reasoning: { enabled: true } }),
    });

    // Extract response with reasoning_details
    type ORChatMessage = (typeof completion)['choices'][number]['message'] & {
      reasoning_details?: unknown;
    };
    const response = completion.choices[0].message as ORChatMessage;

    return {
      content: response.content || '',
      ...(response.reasoning_details
        ? { reasoning_details: response.reasoning_details }
        : {}),
    };
  }
}
