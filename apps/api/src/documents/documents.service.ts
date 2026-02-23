import {
  pipeline,
  type FeatureExtractionPipeline,
} from '@huggingface/transformers';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { documents } from '@worken/database/schema';
import { randomUUID } from 'crypto';
import { and, cosineDistance, count, desc, eq, min, sql } from 'drizzle-orm';
import OpenAI from 'openai';
import { DATABASE, type Database } from '../database/database.module.js';

@Injectable()
export class DocumentsService {
  private embedder: FeatureExtractionPipeline | null = null;
  private openai: OpenAI;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private configService: ConfigService,
  ) {
    this.openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: this.configService.get<string>('OPENROUTER_API_KEY'),
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

  private chunkText(text: string): string[] {
    const paragraphs = text.split(/\n\n+/);
    const chunks: string[] = [];

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();
      if (trimmed.length < 50) continue;

      if (trimmed.length <= 1000) {
        chunks.push(trimmed);
      } else {
        const sentences = trimmed.split(/\.\s+/);
        let current = '';
        for (const sentence of sentences) {
          const candidate = current ? current + '. ' + sentence : sentence;
          if (candidate.length > 1000 && current.length >= 50) {
            chunks.push(current);
            current = sentence;
          } else {
            current = candidate;
          }
        }
        if (current.length >= 50) {
          chunks.push(current);
        }
      }
    }

    return chunks;
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const embedder = await this.getEmbedder();
    const results: number[][] = [];
    for (const text of texts) {
      const output = await embedder(text, { pooling: 'mean', normalize: true });
      results.push(Array.from(output.data as Float32Array));
    }
    return results;
  }

  private async generateTitle(text: string): Promise<string> {
    const snippet = text.slice(0, 500);
    try {
      const response = await this.openai.chat.completions.create({
        model: 'arcee-ai/trinity-large-preview:free',
        messages: [
          {
            role: 'user',
            content: `Summarize what this text is about in 2-5 words. Reply with only the title, no quotes or punctuation.\n\n${snippet}`,
          },
        ],
        max_completion_tokens: 20,
      });
      return (
        response.choices[0]?.message?.content?.trim() || 'Untitled Document'
      );
    } catch {
      return 'Untitled Document';
    }
  }

  async create(projectId: string, content: string) {
    const chunks = this.chunkText(content);
    if (chunks.length === 0) return [];

    const [embeddings, title] = await Promise.all([
      this.embed(chunks),
      this.generateTitle(content),
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

  private async parseFile(buffer: Buffer, mimetype: string): Promise<string> {
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
      console.log('Parsing DOCX file...');
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      console.log(result);
      return result.value;
    }

    throw new BadRequestException(
      'Unsupported file type. Only PDF and DOCX are allowed.',
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
