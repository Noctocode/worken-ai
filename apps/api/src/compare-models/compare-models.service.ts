import { Injectable } from '@nestjs/common';
import OpenAI, { AzureOpenAI } from 'openai';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { AnthropicClientService } from '../integrations/anthropic-client.service.js';
import type { ChatTransportKind } from '../integrations/chat-transport.service.js';

interface QuestionResponse {
  content: string;
  reasoning_details?: unknown;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  /** OpenRouter only — null for native BYOK / Custom endpoints. */
  totalCost?: number;
}

/**
 * `reasoning` is an OpenRouter request-body extension the OpenAI SDK params
 * don't model. Extending the non-streaming params keeps create() resolving
 * to its typed overload instead of collapsing the result to `any`.
 */
interface OpenRouterChatParams extends ChatCompletionCreateParamsNonStreaming {
  reasoning?: { enabled: boolean };
}

// OpenRouter returns a `cost` field on usage the OpenAI types don't model.
interface OpenRouterUsage {
  cost?: number;
}

/** Response message read shape — `reasoning_details` is an OpenRouter
 *  extension absent from the OpenAI ChatCompletionMessage type. */
interface OpenRouterResponseMessage {
  content: string | null;
  reasoning_details?: unknown;
}

// `source` names the upstream in the message. Defaults to OpenRouter
// (the common path), but the judge can now be routed through a BYOK /
// Custom endpoint, where an "OpenRouter ... failed" prefix would be
// misleading — callers pass the actual source in that case.
function describeUpstreamError(
  model: string,
  action: string,
  err: unknown,
  source = 'OpenRouter',
): Error {
  if (err instanceof OpenAI.APIError) {
    const body =
      typeof err.error === 'string'
        ? err.error
        : JSON.stringify(err.error ?? {});
    return new Error(
      `${source} ${action} failed for model "${model}": ${err.status} ${err.name} — ${err.message}${body && body !== '{}' ? ` | body=${body}` : ''}`,
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(`${source} ${action} failed for model "${model}": ${msg}`);
}

@Injectable()
export class CompareModelsService {
  constructor(private readonly anthropic: AnthropicClientService) {}

  private makeClient(
    apiKey?: string,
    baseURL?: string,
    azure?: { endpoint: string; apiVersion: string; deployment: string },
  ): OpenAI {
    const resolved = apiKey ?? process.env['OPENROUTER_API_KEY'];
    if (!resolved) {
      throw new Error(
        'No API key available. Resolver returned empty and OPENROUTER_API_KEY env var is not set.',
      );
    }
    const defaultHeaders = {
      'HTTP-Referer': process.env['SITE_URL'] || '',
      'X-Title': process.env['SITE_NAME'] || 'WorkenAI',
    };
    // Azure judge: AzureOpenAI client (per-resource endpoint +
    // api-version + deployment), same chat.completions wire format.
    if (azure) {
      return new AzureOpenAI({
        endpoint: azure.endpoint,
        apiVersion: azure.apiVersion,
        deployment: azure.deployment,
        apiKey: resolved || 'no-auth',
        defaultHeaders,
      });
    }
    return new OpenAI({
      baseURL: baseURL ?? 'https://openrouter.ai/api/v1',
      apiKey: resolved || 'no-auth',
      defaultHeaders,
    });
  }

  async sendQuestion(
    question: string,
    model: string,
    enableReasoning: boolean = true,
    context?: string,
    apiKey?: string,
    baseURL?: string,
    kind: ChatTransportKind = 'openai-sdk',
  ): Promise<QuestionResponse> {
    // Native Anthropic path for BYOK on Claude.
    if (kind === 'anthropic-sdk') {
      const r = await this.anthropic.sendMessage(
        [{ role: 'user', content: question }],
        model,
        apiKey ?? '',
        context,
      );
      return {
        content: r.content,
        totalTokens: r.totalTokens,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
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

    const body: OpenRouterChatParams = {
      model,
      messages: [...systemMessages, { role: 'user', content: question }],
      ...(enableReasoning && { reasoning: { enabled: true } }),
    };
    let completion: ChatCompletion;
    try {
      completion = await this.makeClient(
        apiKey,
        baseURL,
      ).chat.completions.create(body);
    } catch (err) {
      throw describeUpstreamError(model, 'chat.completions.create', err);
    }

    // Extract response with reasoning_details
    const response = completion.choices[0].message as OpenRouterResponseMessage;

    const orCost = (completion.usage as OpenRouterUsage | undefined)?.cost;
    return {
      content: response.content || '',
      ...(response.reasoning_details
        ? { reasoning_details: response.reasoning_details }
        : {}),
      totalTokens: completion.usage?.total_tokens,
      promptTokens: completion.usage?.prompt_tokens,
      completionTokens: completion.usage?.completion_tokens,
      // Leave undefined when the upstream didn't return cost — controller
      // estimates from the OpenRouter catalog for BYOK / Custom routes.
      ...(orCost != null ? { totalCost: orCost } : {}),
    };
  }

  async compareModelAnswers(
    answers: {
      model: string;
      response: { content: string; reasoning_details?: unknown };
    }[],
    expectedOutput: string,
    model: string,
    enableReasoning: boolean = true,
    apiKey?: string,
    baseURL?: string,
    kind: ChatTransportKind = 'openai-sdk',
    azureEndpoint?: string,
    azureApiVersion?: string,
  ): Promise<QuestionResponse> {
    const systemMessages: { role: 'system'; content: string }[] = [];

    const prompt = `You are an expert AI evaluator with extensive experience benchmarking LLMs. Your job is to strictly compare the provided model answers against the EXPECTED OUTPUT below. Assess accuracy (factual correctness, completeness), closeness to expected output (semantic match, structure, detail level), and overall quality.

        EXPECTED OUTPUT: ${expectedOutput}

        MODEL ANSWERS:

        ${JSON.stringify(answers)}

        Step-by-step evaluation process:

        1. For EACH model: Read its answer. Compare directly to EXPECTED OUTPUT - note matches/mismatches in facts, structure, completeness.

        2. Score from 0.0 to 10.0 (1 decimal): 10.0 = identical to expected; 9+ = near-perfect match; 7-8 = strong but minor gaps; 5-6 = moderate accuracy; <5 = major errors/omissions; 0 = unrelated/wrong.

        3. List 1-5 UNIQUE advantages (e.g., "precise facts", "concise").

        4. List 1-5 UNIQUE disadvantages (e.g., "missed key detail", "added hallucination").

        5. Write 2-5 sentences neutral summary in which the score is also explained against the score of other ai models.

        Output ONLY a valid JSON array of objects, one per model. Use EXACT model names from input (even duplicates). No extra text, explanations, or markdown.

        JSON Schema:

        [
          {
            "name": "exact_model_name_here",
            "score": 9.5,
            "advantages": ["advantage 1", "advantage 2", "advantage 3"],
            "disadvantages": ["disadvantage 1", "disadvantage 2", "disadvantage 3"],
            "summary": "2-5 sentence summary."
          }
        ]

        Ensure: No typos, all fields present, arrays have at least 1 unique short items. Depending on the score better the score more advantages, lower the score more disadvantages. (<10 words each), valid JSON only.`;

    systemMessages.push({
      role: 'system',
      content: prompt,
    });

    // Native Anthropic path for a BYOK Claude model picked as the
    // judge — the prompt is folded into the system slot, the answers
    // JSON into the user turn, matching sendQuestion's BYOK branch.
    if (kind === 'anthropic-sdk') {
      const r = await this.anthropic.sendMessage(
        [{ role: 'user', content: JSON.stringify(answers) }],
        model,
        apiKey ?? '',
        prompt,
      );
      return {
        content: r.content,
        totalTokens: r.totalTokens,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
      };
    }

    const messages = [
      ...systemMessages,
      { role: 'user', content: JSON.stringify(answers) },
    ] as ChatCompletionMessageParam[];

    // Azure judge routes through the AzureOpenAI client; `model` is the
    // deployment name. Other routes keep the plain baseURL client.
    const azure =
      kind === 'azure-sdk' && azureEndpoint && azureApiVersion
        ? {
            endpoint: azureEndpoint,
            apiVersion: azureApiVersion,
            deployment: model,
          }
        : undefined;

    const body: OpenRouterChatParams = {
      model,
      messages,
      // `reasoning` is an OpenRouter extension — Azure OpenAI 400s on
      // unknown body args, so never send it on the azure-sdk route
      // (mirrors ChatService.sendMessageStream).
      ...(enableReasoning &&
        kind !== 'azure-sdk' && { reasoning: { enabled: true } }),
    };
    let completion: ChatCompletion;
    try {
      completion = await this.makeClient(
        apiKey,
        baseURL,
        azure,
      ).chat.completions.create(body);
    } catch (err) {
      // The judge may route through OpenRouter or a BYOK / Custom
      // OpenAI-compatible endpoint — label the message with the actual
      // upstream rather than always saying "OpenRouter".
      const source = baseURL?.includes('openrouter.ai')
        ? 'OpenRouter'
        : 'AI gateway';
      throw describeUpstreamError(
        model,
        'chat.completions.create (compare)',
        err,
        source,
      );
    }

    // Extract response with reasoning_details
    const response = completion.choices[0].message as OpenRouterResponseMessage;

    const orCost = (completion.usage as OpenRouterUsage | undefined)?.cost;
    return {
      content: response.content || '',
      ...(response.reasoning_details
        ? { reasoning_details: response.reasoning_details }
        : {}),
      totalTokens: completion.usage?.total_tokens,
      promptTokens: completion.usage?.prompt_tokens,
      completionTokens: completion.usage?.completion_tokens,
      // Undefined for BYOK / Custom (no upstream cost) — the controller
      // estimates from the OpenRouter catalog in that case.
      ...(orCost != null ? { totalCost: orCost } : {}),
    };
  }
}
