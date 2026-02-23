import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources';

interface QuestionResponse {
  content: string;
  reasoning_details?: unknown;
  totalTokens?: number;
  totalCost?: number;
}

@Injectable()
export class CompareModelsService {
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

  async sendQuestion(
    question: string,
    model: string,
    enableReasoning: boolean = true,
    context?: string,
  ): Promise<QuestionResponse> {
    const systemMessages: { role: 'system'; content: string }[] = [];
    if (context) {
      systemMessages.push({
        role: 'system',
        content:
          'Use the following project context to inform your answers. Reference this information when relevant.\n\n' +
          context,
      });
    }

    const completion = await this.client.chat.completions.create({
      model,
      messages: [...systemMessages, { role: 'user', content: question }],
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
      totalTokens: completion.usage?.total_tokens,
      totalCost: (completion.usage as any)?.cost ?? 0,
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
  ): Promise<QuestionResponse> {
    // const generator = await pipeline('text-generation');
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

    // console.log('Prompting the nodejs model...');
    // const output = await generator(prompt);
    // console.log('Output:', output);

    systemMessages.push({
      role: 'system',
      content: prompt,
    });

    const messages = [
      ...systemMessages,
      { role: 'user', content: JSON.stringify(answers) },
    ] as ChatCompletionMessageParam[];

    const completion = await this.client.chat.completions.create({
      model,
      messages,
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
