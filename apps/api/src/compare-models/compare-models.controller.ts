import { Body, Controller, Post } from '@nestjs/common';
import { CompareModelsService } from './compare-models.service.js';

interface CompareModelsRequestBody {
  models: string[];
  question: string;
  expectedOutput: string;
}

interface CompareModelsResponse {
  model: string;
  response: {
    content: string;
    reasoning_details?: unknown;
  };
  totalTokens: number | undefined;
  totalCost: number | undefined;
  time: number | undefined;
}

@Controller('compare-models')
export class CompareModelsController {
  constructor(private readonly compareModelsService: CompareModelsService) {}

  @Post()
  async compareModels(
    @Body() body: CompareModelsRequestBody,
    // @CurrentUser() user: AuthenticatedUser,
  ) {
    // Get responses from all compared models
    const responses: CompareModelsResponse[] = await Promise.all(
      body.models.map(async (model) => {
        const start = Date.now();
        const response = await this.compareModelsService.sendQuestion(
          body.question,
          model,
          // body.enableReasoning,
          false,
          // context,
        );
        const end = Date.now();
        return {
          model,
          response,
          time: end - start,
          totalTokens: response.totalTokens,
          totalCost: response.totalCost,
        };
      }),
    );

    let comparison;

    let comparisonArray: Array<{
      name: string;
      score: number;
      advantages: string[];
      disadvantages: string[];
      summary: string;
      totalTokens?: number;
      totalCost?: number;
      time?: number;
    }> = [];

    while (comparisonArray.length === 0) {
      comparison = await this.compareModelsService.compareModelAnswers(
        responses,
        body.expectedOutput,
        'stepfun/step-3.5-flash:free',
        // body.enableReasoning,
        false,
      );

      try {
        // Clean up potential non-JSON content from OpenAI output (e.g., explanations, newlines, invalid trailing characters)
        let content = comparison.content ?? '';
        // Remove possible pre/post-text and ensure proper JSON array format
        const jsonStart = content.indexOf('[');
        const jsonEnd = content.lastIndexOf(']');
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          content = content.slice(jsonStart, jsonEnd + 1);
        }
        // Fix common malformed JSON: replace single newlines, fix unquoted keys, ensure correct comma usage, etc.
        // Remove any accidental line breaks inside strings
        content = content.replace(/\r?\n(?!\s*[-\]])/g, ' ');
        // Parse the JSON content as array of objects
        const parsed = JSON.parse(content) as unknown;

        // Map to ensure advantages and disadvantages are always arrays of strings
        comparisonArray = Array.isArray(parsed)
          ? parsed.map((item) => {
              // Use safer typing and fallbacks to avoid TS 'never' and runtime errors
              const advantagesRaw = (item as any).advantages;
              const disadvantagesRaw = (item as any).disadvantages;
              if (advantagesRaw.length === 0 && disadvantagesRaw.length === 0) {
                throw new Error('No advantages or disadvantages found');
              }
              return {
                ...item,
                advantages: Array.isArray(advantagesRaw)
                  ? advantagesRaw
                  : typeof advantagesRaw === 'string'
                    ? // Split string by newline/bullet if seen, else wrap in array
                      advantagesRaw
                        .split(/\n|^\s*-\s*|\\n|•/gm)
                        .map((s: string) => s.trim())
                        .filter(Boolean)
                    : [],
                disadvantages: Array.isArray(disadvantagesRaw)
                  ? disadvantagesRaw
                  : typeof disadvantagesRaw === 'string'
                    ? disadvantagesRaw
                        .split(/\n|^\s*-\s*|\\n|•/gm)
                        .map((s: string) => s.trim())
                        .filter(Boolean)
                    : [],
              };
            })
          : [];
      } catch (e) {
        comparisonArray = [];
      }
    }

    comparisonArray = comparisonArray.map((item) => ({
      ...item,
      totalTokens: responses.find((r) => r.model === item.name)?.totalTokens,
      totalCost: responses.find((r) => r.model === item.name)?.totalCost,
      time: responses.find((r) => r.model === item.name)?.time,
    }));

    return { comparison: comparisonArray, responses };
  }
}
