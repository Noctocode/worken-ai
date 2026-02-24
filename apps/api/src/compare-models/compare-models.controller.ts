import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { KeyResolverService } from '../openrouter/key-resolver.service.js';
import { CompareModelsService } from './compare-models.service.js';

interface CompareModelsRequestBody {
  models: string[];
  question: string;
  expectedOutput: string;
}

interface ModelResponse {
  model: string;
  response: {
    content: string;
    reasoning_details?: unknown;
  };
  totalTokens: number | undefined;
  totalCost: number | undefined;
  time: number;
}

interface RawComparisonItem {
  name: string;
  score: number;
  advantages: string[] | string;
  disadvantages: string[] | string;
  summary: string;
}

interface ComparisonItem {
  name: string;
  score: number;
  advantages: string[];
  disadvantages: string[];
  summary: string;
  totalTokens?: number;
  totalCost?: number;
  time?: number;
}

@Controller('compare-models')
export class CompareModelsController {
  constructor(
    private readonly compareModelsService: CompareModelsService,
    private readonly keyResolverService: KeyResolverService,
  ) {}

  private normalizeStringArray(value: string[] | string): string[] {
    if (Array.isArray(value)) return value;
    return value
      .split(/\n|^\s*-\s*|\\n|•/gm)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private parseComparisonContent(content: string): ComparisonItem[] {
    const jsonStart = content.indexOf('[');
    const jsonEnd = content.lastIndexOf(']');
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) return [];

    // Strip non-JSON wrapping text and normalize line breaks inside strings
    const cleaned = content
      .slice(jsonStart, jsonEnd + 1)
      .replace(/\r?\n(?!\s*[-\]])/g, ' ');

    const parsed = JSON.parse(cleaned) as unknown;
    if (!Array.isArray(parsed)) return [];

    return (parsed as RawComparisonItem[]).map((item) => {
      const advantages = this.normalizeStringArray(item.advantages);
      const disadvantages = this.normalizeStringArray(item.disadvantages);

      if (advantages.length === 0 && disadvantages.length === 0) {
        throw new Error('No advantages or disadvantages found');
      }

      return {
        name: item.name,
        score: item.score,
        summary: item.summary,
        advantages,
        disadvantages,
      };
    });
  }

  @Post()
  async compareModels(
    @Body() body: CompareModelsRequestBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const apiKey = await this.keyResolverService.resolveUserKey(user.id);

    const responses: ModelResponse[] = await Promise.all(
      body.models.map(async (model) => {
        const start = Date.now();
        const response = await this.compareModelsService.sendQuestion(
          body.question,
          model,
          false,
          undefined,
          apiKey,
        );
        return {
          model,
          response,
          time: Date.now() - start,
          totalTokens: response.totalTokens,
          totalCost: response.totalCost,
        };
      }),
    );

    let comparisonItems: ComparisonItem[] = [];

    while (comparisonItems.length === 0) {
      const comparison = await this.compareModelsService.compareModelAnswers(
        responses,
        body.expectedOutput,
        'stepfun/step-3.5-flash:free',
        false,
        apiKey,
      );

      try {
        comparisonItems = this.parseComparisonContent(comparison.content ?? '');
      } catch {
        comparisonItems = [];
      }
    }

    const comparisonWithMetrics = comparisonItems.map((item) => {
      const modelResponse = responses.find((r) => r.model === item.name);
      return {
        ...item,
        totalTokens: modelResponse?.totalTokens,
        totalCost: modelResponse?.totalCost,
        time: modelResponse?.time,
      };
    });

    return { comparison: comparisonWithMetrics, responses };
  }
}
