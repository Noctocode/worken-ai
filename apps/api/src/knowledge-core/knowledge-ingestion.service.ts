import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, cosineDistance, desc, eq, or, sql } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  knowledgeChunks,
  knowledgeDocuments,
  knowledgeFiles,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { DocumentsService } from '../documents/documents.service.js';

export type IngestionStatus =
  | 'pending'
  | 'processing'
  | 'done'
  | 'failed';

export interface IngestionAggregate {
  total: number;
  pending: number;
  processing: number;
  done: number;
  failed: number;
  /** True iff there is at least one row that is not done/failed. */
  inProgress: boolean;
  documents: Array<{
    id: string;
    filename: string;
    status: IngestionStatus;
    error: string | null;
  }>;
}

/**
 * Owns the chunk + embed pipeline for files that came in via the
 * onboarding wizard (`knowledge_documents`). Lives next to
 * KnowledgeCoreService because both deal with user-scoped knowledge,
 * but operates on a different table — the onboarding uploads land in
 * `knowledge_documents`, not `knowledge_files`.
 *
 * The actual chunking + embedding + file parsing is delegated to
 * DocumentsService so onboarding chunks are searchable with the same
 * vector shape as project documents.
 */
@Injectable()
export class KnowledgeIngestionService {
  private readonly logger = new Logger(KnowledgeIngestionService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly documentsService: DocumentsService,
  ) {}

  /**
   * Kick off ingestion for every `pending` row owned by `userId`.
   * Fire-and-forget: we don't await the inner ingestion loop so the
   * onboarding HTTP response can return immediately. The FE polls
   * `getStatus()` to surface progress.
   *
   * Errors inside individual document ingestion are caught and
   * persisted on the row (`ingestion_status='failed'`,
   * `ingestion_error=...`) so a bad PDF doesn't block the rest.
   */
  ingestPendingForUser(userId: string): void {
    void this.runUserIngestion(userId).catch((err) => {
      this.logger.error(
        `Background ingestion crashed for user ${userId}`,
        err instanceof Error ? err.stack : String(err),
      );
    });
  }

  private async runUserIngestion(userId: string): Promise<void> {
    // Claim the pending rows in one round-trip so the worker doesn't
    // pick up the same row twice if `ingestPendingForUser` happens to
    // be invoked concurrently (e.g. user re-runs onboarding while a
    // previous batch is still processing). The `RETURNING` payload is
    // what we'll iterate over.
    const claimed = await this.db
      .update(knowledgeDocuments)
      .set({ ingestionStatus: 'processing' })
      .where(
        and(
          eq(knowledgeDocuments.userId, userId),
          eq(knowledgeDocuments.ingestionStatus, 'pending'),
        ),
      )
      .returning({
        id: knowledgeDocuments.id,
        storagePath: knowledgeDocuments.storagePath,
        mimeType: knowledgeDocuments.mimeType,
        filename: knowledgeDocuments.filename,
        scope: knowledgeDocuments.scope,
      });

    if (claimed.length === 0) return;

    for (const doc of claimed) {
      await this.ingestOne(userId, doc);
    }
  }

  private async ingestOne(
    userId: string,
    doc: {
      id: string;
      storagePath: string;
      mimeType: string | null;
      filename: string;
      scope: string;
    },
  ): Promise<void> {
    try {
      const absolutePath = resolve(process.cwd(), doc.storagePath);
      const buffer = await readFile(absolutePath);

      const mimetype = doc.mimeType ?? this.inferMimeFromName(doc.filename);
      const text = await this.documentsService.parseFile(buffer, mimetype);
      const chunks = this.documentsService.chunkText(text);

      if (chunks.length === 0) {
        // Image-only PDFs / empty files land here. Mark done with a
        // note so the FE can show "no extractable text" — the file
        // still exists on disk, the user just can't query it via RAG.
        await this.db
          .update(knowledgeDocuments)
          .set({
            ingestionStatus: 'done',
            ingestionError: 'No extractable text',
            ingestionCompletedAt: new Date(),
          })
          .where(eq(knowledgeDocuments.id, doc.id));
        return;
      }

      const embeddings = await this.documentsService.embed(chunks);

      // One transaction so we either land all chunks for this document
      // or none — keeps the chunk table from carrying half-ingested
      // documents that the chat RAG would silently use.
      await this.db.transaction(async (tx) => {
        await tx.insert(knowledgeChunks).values(
          chunks.map((content, i) => ({
            userId,
            documentId: doc.id,
            chunkIndex: i,
            content,
            embedding: embeddings[i],
            // Mirror the parent doc's scope so RAG search at chat
            // time can filter without a JOIN.
            scope: doc.scope,
          })),
        );
        await tx
          .update(knowledgeDocuments)
          .set({
            ingestionStatus: 'done',
            ingestionError: null,
            ingestionCompletedAt: new Date(),
          })
          .where(eq(knowledgeDocuments.id, doc.id));
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Ingestion failed for document ${doc.id} (${doc.filename}): ${message}`,
      );
      await this.db
        .update(knowledgeDocuments)
        .set({
          ingestionStatus: 'failed',
          ingestionError: message.slice(0, 500),
          ingestionCompletedAt: new Date(),
        })
        .where(eq(knowledgeDocuments.id, doc.id));
    }
  }

  /**
   * Same pipeline as `ingestPendingForUser`, but for files uploaded
   * via the post-onboarding /knowledge-core page (`knowledge_files`).
   * Same fire-and-forget, claim-via-UPDATE...RETURNING approach so
   * concurrent uploads don't double-ingest. Chunks land in the
   * shared `knowledge_chunks` table with `fileId` set (instead of
   * `documentId`), keeping chat-time RAG search uniform across
   * sources.
   */
  ingestPendingFilesForUser(userId: string): void {
    void this.runUserFileIngestion(userId).catch((err) => {
      this.logger.error(
        `Background file ingestion crashed for user ${userId}`,
        err instanceof Error ? err.stack : String(err),
      );
    });
  }

  private async runUserFileIngestion(userId: string): Promise<void> {
    // Files are scoped to folders, and folders are owned by users.
    // We claim only files this user uploaded that are still pending.
    const claimed = await this.db
      .update(knowledgeFiles)
      .set({ ingestionStatus: 'processing' })
      .where(
        and(
          eq(knowledgeFiles.uploadedById, userId),
          eq(knowledgeFiles.ingestionStatus, 'pending'),
        ),
      )
      .returning({
        id: knowledgeFiles.id,
        storagePath: knowledgeFiles.storagePath,
        name: knowledgeFiles.name,
        scope: knowledgeFiles.scope,
      });

    if (claimed.length === 0) return;

    for (const file of claimed) {
      await this.ingestOneFile(userId, file);
    }
  }

  private async ingestOneFile(
    userId: string,
    file: {
      id: string;
      storagePath: string | null;
      name: string;
      scope: string;
    },
  ): Promise<void> {
    try {
      if (!file.storagePath) {
        throw new Error('File has no storage path on disk');
      }
      const absolutePath = resolve(process.cwd(), file.storagePath);
      const buffer = await readFile(absolutePath);

      // Knowledge Core uploads don't store mimetype on the row; infer
      // from the filename. parseFile rejects unsupported types — for
      // images / spreadsheets the catch block below records a clear
      // ingestion_error and the file row + disk copy stay so the user
      // can still download.
      const mimetype = this.inferMimeFromName(file.name);
      const text = await this.documentsService.parseFile(buffer, mimetype);
      const chunks = this.documentsService.chunkText(text);

      if (chunks.length === 0) {
        await this.db
          .update(knowledgeFiles)
          .set({
            ingestionStatus: 'done',
            ingestionError: 'No extractable text',
            ingestionCompletedAt: new Date(),
          })
          .where(eq(knowledgeFiles.id, file.id));
        return;
      }

      const embeddings = await this.documentsService.embed(chunks);

      await this.db.transaction(async (tx) => {
        await tx.insert(knowledgeChunks).values(
          chunks.map((content, i) => ({
            userId,
            fileId: file.id,
            chunkIndex: i,
            content,
            embedding: embeddings[i],
            scope: file.scope,
          })),
        );
        await tx
          .update(knowledgeFiles)
          .set({
            ingestionStatus: 'done',
            ingestionError: null,
            ingestionCompletedAt: new Date(),
          })
          .where(eq(knowledgeFiles.id, file.id));
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Ingestion failed for knowledge_file ${file.id} (${file.name}): ${message}`,
      );
      await this.db
        .update(knowledgeFiles)
        .set({
          ingestionStatus: 'failed',
          ingestionError: message.slice(0, 500),
          ingestionCompletedAt: new Date(),
        })
        .where(eq(knowledgeFiles.id, file.id));
    }
  }

  /**
   * Aggregated ingestion status for a user. Drives the step-6 progress
   * screen and the dashboard "still training" banner.
   */
  async getStatus(userId: string): Promise<IngestionAggregate> {
    const rows = await this.db
      .select({
        id: knowledgeDocuments.id,
        filename: knowledgeDocuments.filename,
        status: knowledgeDocuments.ingestionStatus,
        error: knowledgeDocuments.ingestionError,
      })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.userId, userId));

    const docs = rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      status: (r.status as IngestionStatus) ?? 'pending',
      error: r.error ?? null,
    }));

    const counts = {
      pending: 0,
      processing: 0,
      done: 0,
      failed: 0,
    };
    for (const d of docs) counts[d.status] = (counts[d.status] ?? 0) + 1;

    return {
      total: docs.length,
      pending: counts.pending,
      processing: counts.processing,
      done: counts.done,
      failed: counts.failed,
      inProgress: counts.pending + counts.processing > 0,
      documents: docs,
    };
  }

  /**
   * Cosine-similarity search over chunks the caller is allowed to
   * see at chat time. Two visibility rules OR'd together:
   *
   *   - the caller's own personal-scope chunks (their own onboarding
   *     uploads on the personal branch)
   *   - any company-scope chunks (single-tenant deployment, so
   *     'company' = org-wide — the company admin's uploads are
   *     intentionally readable by every invited user)
   *
   * Mirrors DocumentsService.searchRelevant but with this hybrid
   * scoping. Used by the chat layer to mix personal + company
   * knowledge into RAG context alongside project documents.
   */
  async searchAccessibleChunks(userId: string, query: string, limit = 5) {
    const [queryEmbedding] = await this.documentsService.embed([query]);
    const similarity = sql<number>`1 - (${cosineDistance(knowledgeChunks.embedding, queryEmbedding)})`;

    return this.db
      .select({
        id: knowledgeChunks.id,
        documentId: knowledgeChunks.documentId,
        content: knowledgeChunks.content,
        similarity,
      })
      .from(knowledgeChunks)
      .where(
        or(
          and(
            eq(knowledgeChunks.userId, userId),
            eq(knowledgeChunks.scope, 'personal'),
          ),
          eq(knowledgeChunks.scope, 'company'),
        ),
      )
      .orderBy(desc(similarity))
      .limit(limit);
  }

  private inferMimeFromName(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.docx')) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (lower.endsWith('.txt')) return 'text/plain';
    if (lower.endsWith('.md')) return 'text/markdown';
    if (lower.endsWith('.csv')) return 'text/csv';
    return 'application/octet-stream';
  }
}
