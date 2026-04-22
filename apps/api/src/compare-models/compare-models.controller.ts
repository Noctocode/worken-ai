import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { KeyResolverService } from '../openrouter/key-resolver.service.js';
import { CompareModelsService } from './compare-models.service.js';

const MAX_COMPARE_ATTEMPTS = 3;

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
  private readonly logger = new Logger(CompareModelsController.name);

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
    if (!body?.models?.length) {
      throw new BadRequestException('`models` must be a non-empty array.');
    }
    if (!body.question?.trim()) {
      throw new BadRequestException('`question` is required.');
    }

    let apiKey: string;
    try {
      apiKey = await this.keyResolverService.resolveUserKey(user.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Key resolution failed for user ${user.id}: ${msg}`);
      throw new ServiceUnavailableException(`OpenRouter key unavailable: ${msg}`);
    }

    let responses: ModelResponse[];
    try {
      responses = await Promise.all(
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Model completion failed: ${msg}`);
      throw new BadGatewayException(msg);
    }

    let comparisonItems: ComparisonItem[] = [];
    let lastParseError: string | undefined;
    let lastRawContent = '';

    for (let attempt = 1; attempt <= MAX_COMPARE_ATTEMPTS; attempt++) {
      let comparison;
      try {
        comparison = await this.compareModelsService.compareModelAnswers(
          responses,
          body.expectedOutput,
          'stepfun/step-3.5-flash:free',
          false,
          apiKey,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Evaluator call failed on attempt ${attempt}/${MAX_COMPARE_ATTEMPTS}: ${msg}`,
        );
        throw new BadGatewayException(`Evaluator model failed: ${msg}`);
      }

      lastRawContent = comparison.content ?? '';
      try {
        comparisonItems = this.parseComparisonContent(lastRawContent);
      } catch (err) {
        lastParseError = err instanceof Error ? err.message : String(err);
        comparisonItems = [];
      }

      if (comparisonItems.length > 0) break;

      this.logger.warn(
        `Evaluator returned unparseable output on attempt ${attempt}/${MAX_COMPARE_ATTEMPTS}${
          lastParseError ? ` (${lastParseError})` : ''
        }. Raw content preview: ${lastRawContent.slice(0, 200)}`,
      );
    }

    if (comparisonItems.length === 0) {
      throw new BadGatewayException(
        `Evaluator failed to produce valid JSON after ${MAX_COMPARE_ATTEMPTS} attempts.${
          lastParseError ? ` Last parse error: ${lastParseError}.` : ''
        } Last raw content preview: ${lastRawContent.slice(0, 200)}`,
      );
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
