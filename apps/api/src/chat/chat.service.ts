import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { AnthropicClientService } from '../integrations/anthropic-client.service.js';
import type { ChatTransportKind } from '../integrations/chat-transport.service.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning_details?: unknown;
}

interface ChatResponse {
  content: string;
  reasoning_details?: unknown;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  /** Set by OpenRouter only; null for native BYOK / Custom endpoints. */
  totalCost?: number;
}

// OpenRouter returns a `cost` field on usage that the OpenAI types don't
// model; we read it through this loose shape.
interface OpenRouterUsage {
  cost?: number;
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

@Injectable()
export class ChatService {
  constructor(private readonly anthropic: AnthropicClientService) {}

  private makeClient(baseURL: string, apiKey: string): OpenAI {
    return new OpenAI({
      baseURL,
      // OpenAI SDK rejects empty apiKey; pass a placeholder for endpoints
      // that don't need auth (rare — local Ollama, internal vLLM, …).
      apiKey: apiKey || 'no-auth',
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
    apiKey: string = '',
    baseURL: string = 'https://openrouter.ai/api/v1',
    kind: ChatTransportKind = 'openai-sdk',
  ): Promise<ChatResponse> {
    // Route to the Anthropic native SDK when the transport says so —
    // Anthropic's Messages API isn't OpenAI-compatible, so we can't
    // just point the OpenAI SDK at https://api.anthropic.com/v1.
    if (kind === 'anthropic-sdk') {
      const r = await this.anthropic.sendMessage(
        messages.map((m) => ({ role: m.role, content: m.content })),
        model,
        apiKey,
        context,
      );
      return {
        content: r.content,
        totalTokens: r.totalTokens,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        // Anthropic doesn't return cost — controller estimates it via
        // OpenRouter catalog pricing.
      };
    }

    const systemMessages: { role: 'system'; content: string }[] = [];
    if (context) {
      systemMessages.push({
        role: 'system',
        content:
          'Use the following project context to inform your answers. Reference this information when relevant.\n\n' +
          context,
      });
    }

    const completion = await this.makeClient(baseURL, apiKey).chat.completions.create({
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

    const usage = completion.usage as OpenRouterUsage | undefined;

    return {
      content: response.content || '',
      ...(response.reasoning_details
        ? { reasoning_details: response.reasoning_details }
        : {}),
      totalTokens: usage?.total_tokens,
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      totalCost: usage?.cost,
    };
  }
}
