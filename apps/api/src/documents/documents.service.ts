import { Inject, Injectable } from '@nestjs/common';
import { cosineDistance, desc, eq, sql } from 'drizzle-orm';
import { documents } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import {
  pipeline,
  type FeatureExtractionPipeline,
} from '@huggingface/transformers';

@Injectable()
export class DocumentsService {
  private embedder: FeatureExtractionPipeline | null = null;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

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

  async create(projectId: string, content: string) {
    const chunks = this.chunkText(content);
    if (chunks.length === 0) return [];

    const embeddings = await this.embed(chunks);

    const rows = chunks.map((chunk, i) => ({
      projectId,
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
}
