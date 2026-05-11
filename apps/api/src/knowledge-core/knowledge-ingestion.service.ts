import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, cosineDistance, desc, eq, or, sql } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  knowledgeChunks,
  knowledgeFiles,
  knowledgeFolders,
  users,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { DocumentsService } from '../documents/documents.service.js';

// Mirror of the constant in OnboardingService — kept inline rather than
// shared so the two modules stay decoupled. If you rename the onboarding
// folder, update both.
const ONBOARDING_FOLDER_NAME = 'Onboarding';

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
 * Owns the chunk + embed pipeline for user-uploaded knowledge files —
 * both onboarding-wizard uploads and post-onboarding Knowledge Core
 * uploads land in the same `knowledge_files` table, so a single
 * ingestion path covers both. (The legacy `knowledge_documents` table
 * still holds historical rows but is read-only now; the backfill
 * script in `packages/database/backfill/` migrates them to
 * `knowledge_files` and re-links their chunks.)
 *
 * The actual chunking + embedding + file parsing is delegated to
 * DocumentsService so chunks are searchable with the same vector
 * shape as project documents.
 */
@Injectable()
export class KnowledgeIngestionService {
  private readonly logger = new Logger(KnowledgeIngestionService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly documentsService: DocumentsService,
  ) {}

  /**
   * Kick off ingestion for `pending` files owned by `userId` (across
   * all folders, including the auto-created "Onboarding" folder).
   * Fire-and-forget so the HTTP response returns immediately while
   * the worker runs in the background. Chunks land in
   * `knowledge_chunks` with `fileId` set; the FE polls `getStatus()`
   * to surface progress. Errors inside individual file ingestion are
   * caught and persisted on the row (`ingestion_status='failed'`,
   * `ingestion_error=...`) so a bad PDF doesn't block the rest.
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
        visibility: knowledgeFiles.visibility,
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
      visibility: string;
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
            visibility: file.visibility,
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
   * screen — only inspects the auto-created "Onboarding" folder so
   * post-onboarding KC uploads (which the user manages with their own
   * per-file badges in /knowledge-core) don't keep step-6 spinning
   * after the wizard finishes.
   */
  async getStatus(userId: string): Promise<IngestionAggregate> {
    const rows = await this.db
      .select({
        id: knowledgeFiles.id,
        filename: knowledgeFiles.name,
        status: knowledgeFiles.ingestionStatus,
        error: knowledgeFiles.ingestionError,
      })
      .from(knowledgeFiles)
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .where(
        and(
          eq(knowledgeFolders.ownerId, userId),
          eq(knowledgeFolders.name, ONBOARDING_FOLDER_NAME),
        ),
      );

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
    // Admin gating on the second visibility layer: company-scope
    // chunks marked `visibility='admins'` are reachable only when
    // the caller has role='admin'. Personal-scope chunks are
    // owner-only via the userId filter — visibility doesn't apply
    // there. One round-trip to read role; uploads aren't a hot
    // path, but chat-time RAG runs on every prompt — keeping this
    // a single SELECT per call is intentional.
    const [caller] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId));
    const isAdmin = caller?.role === 'admin';

    const [queryEmbedding] = await this.documentsService.embed([query]);
    const similarity = sql<number>`1 - (${cosineDistance(knowledgeChunks.embedding, queryEmbedding)})`;

    // Company-scope filter: 'all' is universally readable; 'admins'
    // is only readable when the caller is admin. Building the
    // company branch as a sub-AND keeps the personal branch alone
    // when the caller isn't admin AND the chunk is admin-only.
    const companyBranch = isAdmin
      ? eq(knowledgeChunks.scope, 'company')
      : and(
          eq(knowledgeChunks.scope, 'company'),
          eq(knowledgeChunks.visibility, 'all'),
        );

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
          companyBranch,
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
