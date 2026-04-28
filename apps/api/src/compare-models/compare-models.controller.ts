import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  ServiceUnavailableException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { and, desc, eq } from 'drizzle-orm';
import { arenaRuns } from '@worken/database/schema';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { KeyResolverService } from '../openrouter/key-resolver.service.js';
import { CompareModelsService } from './compare-models.service.js';

const ATTACHMENT_MAX_BYTES = 30 * 1024 * 1024;
const OCR_MODEL = 'baidu/qianfan-ocr-fast:free';
const IMAGE_MIMETYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

const MAX_COMPARE_ATTEMPTS = 3;

interface CompareModelsRequestBody {
  models: string[];
  question: string;
  expectedOutput: string;
  context?: string;
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
    @Inject(DATABASE) private readonly db: Database,
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
    if (!Array.isArray(body?.models) || body.models.length === 0) {
      throw new BadRequestException('`models` must be a non-empty array.');
    }
    const cleanedModels: string[] = [];
    const seen = new Set<string>();
    for (const m of body.models) {
      if (typeof m !== 'string') {
        throw new BadRequestException('`models` entries must be strings.');
      }
      const trimmed = m.trim();
      if (!trimmed) {
        throw new BadRequestException('`models` entries must be non-empty.');
      }
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      cleanedModels.push(trimmed);
    }
    body.models = cleanedModels;

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
            body.context,
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
          'nvidia/nemotron-3-super-120b-a12b:free',
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

    let runId: string | undefined;
    try {
      const [row] = await this.db
        .insert(arenaRuns)
        .values({
          userId: user.id,
          question: body.question,
          expectedOutput: body.expectedOutput ?? '',
          models: body.models,
          responses,
          comparison: comparisonWithMetrics,
        })
        .returning({ id: arenaRuns.id });
      runId = row?.id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to persist arena run for user ${user.id}: ${msg}`);
    }

    return { runId, comparison: comparisonWithMetrics, responses };
  }

  @Get('runs')
  async listRuns(@CurrentUser() user: AuthenticatedUser) {
    const rows = await this.db
      .select({
        id: arenaRuns.id,
        question: arenaRuns.question,
        createdAt: arenaRuns.createdAt,
      })
      .from(arenaRuns)
      .where(eq(arenaRuns.userId, user.id))
      .orderBy(desc(arenaRuns.createdAt))
      .limit(50);

    return rows;
  }

  @Get('runs/:id')
  async getRun(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const [row] = await this.db
      .select()
      .from(arenaRuns)
      .where(and(eq(arenaRuns.id, id), eq(arenaRuns.userId, user.id)));

    if (!row) {
      throw new NotFoundException('Arena run not found.');
    }

    return {
      id: row.id,
      question: row.question,
      expectedOutput: row.expectedOutput,
      models: row.models as string[],
      responses: row.responses as ModelResponse[],
      comparison: row.comparison as ComparisonItem[],
      createdAt: row.createdAt,
    };
  }

  @Delete('runs/:id')
  @HttpCode(204)
  async deleteRun(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    const deleted = await this.db
      .delete(arenaRuns)
      .where(and(eq(arenaRuns.id, id), eq(arenaRuns.userId, user.id)))
      .returning({ id: arenaRuns.id });

    if (deleted.length === 0) {
      throw new NotFoundException('Arena run not found.');
    }
  }

  @Post('attachments/parse')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: ATTACHMENT_MAX_BYTES },
    }),
  )
  async parseAttachment(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ name: string; content: string }> {
    if (!file) {
      throw new BadRequestException('No file was uploaded.');
    }

    const mimetype = file.mimetype;
    const name = file.originalname;
    const lowerName = name.toLowerCase();

    let content: string;

    if (IMAGE_MIMETYPES.has(mimetype)) {
      let apiKey: string;
      try {
        apiKey = await this.keyResolverService.resolveUserKey(user.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ServiceUnavailableException(
          `OpenRouter key unavailable for OCR: ${msg}`,
        );
      }

      const dataUrl = `data:${mimetype};base64,${file.buffer.toString('base64')}`;
      let extracted: string;
      try {
        extracted = await this.compareModelsService.extractTextFromImage(
          dataUrl,
          OCR_MODEL,
          apiKey,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`OCR failed for "${name}": ${msg}`);
        throw new BadGatewayException(msg);
      }
      content = extracted === 'NO_TEXT_FOUND' ? '' : extracted;
    } else {
      try {
        if (mimetype === 'application/pdf' || lowerName.endsWith('.pdf')) {
          const { PDFParse } = await import('pdf-parse');
          const parser = new PDFParse({ data: file.buffer });
          const result = await parser.getText();
          content = result.text;
        } else if (
          mimetype ===
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          lowerName.endsWith('.docx')
        ) {
          const mammoth = await import('mammoth');
          const result = await mammoth.extractRawText({ buffer: file.buffer });
          content = result.value;
        } else if (
          mimetype.startsWith('text/') ||
          mimetype === 'application/json' ||
          mimetype === 'application/xml'
        ) {
          content = file.buffer.toString('utf8');
        } else {
          const dot = lowerName.lastIndexOf('.');
          const ext = dot !== -1 && dot < lowerName.length - 1 ? lowerName.slice(dot) : '';
          const detail = ext
            ? `"${ext}" (${mimetype || 'no MIME type'})`
            : `"${mimetype || 'unknown type'}"`;
          throw new BadRequestException(
            `Unsupported file type ${detail}. Only PDF, DOCX, images (PNG, JPG, JPEG, WebP, GIF), and text-based files (TXT, MD, CSV, JSON, code) are allowed.`,
          );
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to parse attachment "${name}": ${msg}`);
        throw new BadRequestException(`Failed to parse "${name}": ${msg}`);
      }
    }

    if (!content.trim()) {
      throw new BadRequestException(
        `No text could be extracted from "${name}". The file may be scanned, image-only or empty.`,
      );
    }

    return { name, content };
  }
}
