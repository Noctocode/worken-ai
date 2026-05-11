import {
  pipeline,
  type FeatureExtractionPipeline,
} from '@huggingface/transformers';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { documents } from '@worken/database/schema';
import { randomUUID } from 'crypto';
import { and, cosineDistance, count, desc, eq, min, sql } from 'drizzle-orm';
import OpenAI from 'openai';
import { DATABASE, type Database } from '../database/database.module.js';
import { ObservabilityService } from '../observability/observability.service.js';

interface OpenRouterUsage {
  cost?: number;
  total_tokens?: number;
}

@Injectable()
export class DocumentsService {
  private embedder: FeatureExtractionPipeline | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly observabilityService: ObservabilityService,
  ) {}

  private makeClient(apiKey?: string): OpenAI {
    return new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: apiKey ?? process.env['OPENROUTER_API_KEY'],
    });
  }

  private async getEmbedder(): Promise<FeatureExtractionPipeline> {
    if (!this.embedder) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      this.embedder = await (pipeline as any)(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
      );
    }
    return this.embedder!;
  }

  // Public so KnowledgeIngestionService can reuse the same chunking
  // strategy as project-level documents — keeps embeddings searchable
  // together at chat time.
  //
  // Strategy: buffer short paragraphs together until they hit the
  // ~1000-char chunk size, then flush. Long paragraphs are emitted
  // on their own (split on sentence boundaries if they exceed the
  // limit). The previous version dropped every paragraph under 50
  // characters individually, which silently killed structured short-
  // line docs (product catalogs, glossaries, key-value lists where
  // every line is "name — value"). Now any non-empty content lands
  // in at least one chunk — embedding similarity handles relevance
  // at search time, so we don't need a length floor here.
  chunkText(text: string): string[] {
    const paragraphs = text.split(/\n\n+/);
    const chunks: string[] = [];
    let buffer = '';

    const flushBuffer = () => {
      const trimmed = buffer.trim();
      if (trimmed.length > 0) chunks.push(trimmed);
      buffer = '';
    };

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();
      if (!trimmed) continue;

      // Long paragraph: flush whatever's buffered first, then split
      // this one on sentence boundaries so no single chunk exceeds
      // the embedding token budget.
      if (trimmed.length > 1000) {
        flushBuffer();
        const sentences = trimmed.split(/\.\s+/);
        let current = '';
        for (const sentence of sentences) {
          const candidate = current ? current + '. ' + sentence : sentence;
          if (candidate.length > 1000 && current.length > 0) {
            chunks.push(current);
            current = sentence;
          } else {
            current = candidate;
          }
        }
        if (current.trim().length > 0) chunks.push(current.trim());
        continue;
      }

      // Short / medium paragraph: accumulate. `\n\n` preserves the
      // paragraph break inside the chunk so the model sees the same
      // structure the user wrote.
      const candidate = buffer ? buffer + '\n\n' + trimmed : trimmed;
      if (candidate.length > 1000) {
        flushBuffer();
        buffer = trimmed;
      } else {
        buffer = candidate;
      }
    }

    flushBuffer();
    return chunks;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const embedder = await this.getEmbedder();
    const results: number[][] = [];
    for (const text of texts) {
      const output = await embedder(text, { pooling: 'mean', normalize: true });
      results.push(Array.from(output.data as Float32Array));
    }
    return results;
  }

  private async generateTitle(
    text: string,
    apiKey?: string,
    callerUserId?: string,
  ): Promise<string> {
    const snippet = text.slice(0, 500);
    const TITLE_MODEL = 'arcee-ai/trinity-large-preview:free';
    const start = Date.now();
    try {
      const response = await this.makeClient(apiKey).chat.completions.create({
        model: TITLE_MODEL,
        messages: [
          {
            role: 'user',
            content: `Summarize what this text is about in 2-5 words. Reply with only the title, no quotes or punctuation.\n\n${snippet}`,
          },
        ],
        max_completion_tokens: 20,
      });
      if (callerUserId) {
        const usage = response.usage as OpenRouterUsage | undefined;
        const teamId =
          await this.observabilityService.getPrimaryTeamId(callerUserId);
        void this.observabilityService.recordLLMCall({
          userId: callerUserId,
          teamId,
          eventType: 'document_title',
          model: TITLE_MODEL,
          totalTokens: usage?.total_tokens,
          costUsd: usage?.cost,
          latencyMs: Date.now() - start,
          success: true,
          metadata: { phase: 'title-generation' },
        });
      }
      return (
        response.choices[0]?.message?.content?.trim() || 'Untitled Document'
      );
    } catch (err) {
      if (callerUserId) {
        const teamId =
          await this.observabilityService.getPrimaryTeamId(callerUserId);
        void this.observabilityService.recordLLMCall({
          userId: callerUserId,
          teamId,
          eventType: 'document_title',
          model: TITLE_MODEL,
          latencyMs: Date.now() - start,
          success: false,
          errorMessage: err instanceof Error ? err.message : String(err),
          metadata: { phase: 'title-generation' },
        });
      }
      return 'Untitled Document';
    }
  }

  async create(
    projectId: string,
    content: string,
    apiKey?: string,
    callerUserId?: string,
  ) {
    const chunks = this.chunkText(content);
    if (chunks.length === 0) return [];

    const [embeddings, title] = await Promise.all([
      this.embed(chunks),
      this.generateTitle(content, apiKey, callerUserId),
    ]);

    const groupId = randomUUID();

    const rows = chunks.map((chunk, i) => ({
      projectId,
      groupId,
      title,
      content: chunk,
      embedding: embeddings[i],
    }));

    return this.db.insert(documents).values(rows).returning();
  }

  async findByProject(projectId: string) {
    return this.db
      .select({
        id: documents.id,
        content: documents.content,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(eq(documents.projectId, projectId))
      .orderBy(desc(documents.createdAt));
  }

  async findGroupsByProject(projectId: string) {
    return this.db
      .select({
        groupId: documents.groupId,
        title: documents.title,
        createdAt: min(documents.createdAt),
        chunkCount: count(),
      })
      .from(documents)
      .where(eq(documents.projectId, projectId))
      .groupBy(documents.groupId, documents.title)
      .orderBy(desc(min(documents.createdAt)));
  }

  async removeByGroup(projectId: string, groupId: string) {
    return this.db
      .delete(documents)
      .where(
        and(eq(documents.groupId, groupId), eq(documents.projectId, projectId)),
      )
      .returning();
  }

  // standard vector similarity search for RAG. 1.0 = identical
  // todo: drop irrelevant chunks (minimum similartiy treshold)
  async searchRelevant(projectId: string, query: string, limit = 5) {
    const [queryEmbedding] = await this.embed([query]);

    const similarity = sql<number>`1 - (${cosineDistance(documents.embedding, queryEmbedding)})`;

    return this.db
      .select({
        id: documents.id,
        content: documents.content,
        similarity,
      })
      .from(documents)
      .where(eq(documents.projectId, projectId))
      .orderBy(desc(similarity))
      .limit(limit);
  }

  async remove(id: string) {
    return this.db.delete(documents).where(eq(documents.id, id)).returning();
  }

  async parseFile(buffer: Buffer, mimetype: string): Promise<string> {
    if (mimetype === 'application/pdf') {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      return result.text;
    }

    if (
      mimetype ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    // XLSX / XLS / legacy .xls macro-enabled too. SheetJS handles all
    // formats off one read; we flatten every sheet to CSV-ish text
    // and prefix with the sheet name so the embedder gets some
    // structural signal alongside the cells. Empty / image-only
    // workbooks return ''.
    if (
      mimetype ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimetype === 'application/vnd.ms-excel'
    ) {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const sections: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        if (csv.trim().length === 0) continue;
        sections.push(`## ${sheetName}\n\n${csv}`);
      }
      return sections.join('\n\n');
    }

    if (
      mimetype === 'text/plain' ||
      mimetype === 'text/markdown' ||
      mimetype === 'text/csv'
    ) {
      return buffer.toString('utf-8');
    }

    throw new BadRequestException(
      'Unsupported file type. Only PDF, DOCX, XLSX, TXT, MD, and CSV are allowed.',
    );
  }

  async createFromFile(
    projectId: string,
    buffer: Buffer,
    mimetype: string,
    filename: string,
  ) {
    const text = await this.parseFile(buffer, mimetype);
    const chunks = this.chunkText(text);
    if (chunks.length === 0) {
      throw new BadRequestException(
        'No text could be extracted from this file. It may contain only images or unsupported content.',
      );
    }
    const embeddings = await this.embed(chunks);
    const title = filename.replace(/\.[^.]+$/, '');
    const groupId = randomUUID();

    const rows = chunks.map((chunk, i) => ({
      projectId,
      groupId,
      title,
      content: chunk,
      embedding: embeddings[i],
    }));

    return this.db.insert(documents).values(rows).returning();
  }
}
