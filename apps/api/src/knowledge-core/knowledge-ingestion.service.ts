import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, cosineDistance, desc, eq, inArray, or, sql } from 'drizzle-orm';
import OpenAI from 'openai';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  knowledgeChunks,
  knowledgeFiles,
  knowledgeFileTeams,
  knowledgeFolders,
  teamMembers,
  users,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { DocumentsService } from '../documents/documents.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { KeyResolverService } from '../openrouter/key-resolver.service.js';

// Mirror of the constant in OnboardingService — kept inline rather than
// shared so the two modules stay decoupled. If you rename the onboarding
// folder, update both.
const ONBOARDING_FOLDER_NAME = 'Onboarding';

// OCR model used for image uploads. Same model arena uses for
// attachment OCR (compare-models.controller) — :free tier so cost
// stays predictable. The OCR call always routes through OpenRouter,
// regardless of any BYOK keys the user might have for chat — vision
// support varies across providers and we don't want to surprise the
// user with an Anthropic-only key failing on an image.
const OCR_MODEL = 'baidu/qianfan-ocr-fast:free';
const IMAGE_MIMETYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);
const NO_TEXT_MARKER = 'NO_TEXT_FOUND';

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
 * Owns the chunk + embed pipeline for user-uploaded knowledge files.
 * Both onboarding-wizard uploads and post-onboarding Knowledge Core
 * uploads land in the same `knowledge_files` table, so a single
 * ingestion path covers both.
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
    private readonly keyResolver: KeyResolverService,
    private readonly notifications: NotificationsService,
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
      // from the filename. Two paths:
      //   - Image (PNG / JPG / WEBP / GIF) → OpenRouter OCR. The user's
      //     resolveUserKey is required; the catch below records the
      //     clear "no key" error if it isn't provisioned (typically
      //     budget=0 on managed cloud) and the file row + disk copy
      //     stay so the user can still download.
      //   - Everything else → DocumentsService.parseFile (PDF, DOCX,
      //     XLSX, TXT, MD, CSV). Unsupported types throw and land in
      //     the same catch block.
      const mimetype = this.inferMimeFromName(file.name);
      const text = IMAGE_MIMETYPES.has(mimetype)
        ? await this.extractTextFromImage(userId, buffer, mimetype)
        : await this.documentsService.parseFile(buffer, mimetype);
      const chunks = this.documentsService.chunkText(text);

      if (chunks.length === 0) {
        // No chunks → nothing searchable. Mark `failed` rather than
        // `done` so the FE badge renders as "Skipped" with the
        // tooltip error, consistent with other parse failures.
        // Image-only PDFs and empty workbooks land here.
        await this.db
          .update(knowledgeFiles)
          .set({
            ingestionStatus: 'failed',
            ingestionError: 'No extractable text',
            ingestionCompletedAt: new Date(),
          })
          .where(eq(knowledgeFiles.id, file.id));
        await this.notifyIngestionFailure(
          userId,
          file.id,
          file.name,
          'No extractable text',
        );
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
      await this.notifyIngestionFailure(userId, file.id, file.name, message);
    }
  }

  /**
   * Notify the uploader that one of their Knowledge Core files
   * didn't make it through ingestion. Best-effort — alert failures
   * never bubble up; the worker keeps going on the remaining
   * `pending` rows.
   */
  private async notifyIngestionFailure(
    uploaderId: string,
    fileId: string,
    fileName: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.notifications.create({
        userId: uploaderId,
        type: 'file_ingestion_failed',
        title: `"${fileName}" couldn't be added to Knowledge Core`,
        body: reason.slice(0, 200),
        data: { fileId, fileName, reason: reason.slice(0, 500) },
      });
    } catch {
      // swallow — this is fire-and-forget audit
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

    // Company-scope filter, now tri-state:
    //   - admin caller: every company chunk is fair game (admins see
    //     all + admins-only + every teams-restricted file regardless
    //     of membership; admins manage the org).
    //   - non-admin caller: 'all' chunks always; 'teams' chunks only
    //     when caller is an accepted member of one of the linked
    //     teams. 'admins' chunks are off-limits.
    //
    // The teams branch probes via EXISTS against the join table.
    // Indexes on knowledge_file_teams (file_id) and team_members
    // (user_id, status) keep this sub-millisecond per chunk.
    const companyBranch = isAdmin
      ? eq(knowledgeChunks.scope, 'company')
      : or(
          and(
            eq(knowledgeChunks.scope, 'company'),
            eq(knowledgeChunks.visibility, 'all'),
          ),
          and(
            eq(knowledgeChunks.scope, 'company'),
            eq(knowledgeChunks.visibility, 'teams'),
            sql`EXISTS (
              SELECT 1
              FROM ${knowledgeFileTeams} kft
              INNER JOIN ${teamMembers} tm
                ON tm.team_id = kft.team_id
              WHERE kft.file_id = ${knowledgeChunks.fileId}
                AND tm.user_id = ${userId}
                AND tm.status = 'accepted'
            )`,
          ),
        );

    return this.db
      .select({
        id: knowledgeChunks.id,
        fileId: knowledgeChunks.fileId,
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

  /**
   * Cosine-similarity search restricted to KC files explicitly
   * attached to a project. Applies the SAME visibility scopes as
   * `searchAccessibleChunks` so flipping a file to 'admins' / 'teams'
   * also restricts its content inside any project it's attached to.
   * Attaching is a discoverability signal, not a privilege override —
   * the file owner's visibility choice is authoritative.
   *
   * The `fileIds` set is pre-resolved by the chat path (project's
   * project_knowledge_files rows); this service then enforces who's
   * allowed to read each one's chunks.
   */
  async searchProjectAttachedChunks(
    userId: string,
    fileIds: string[],
    query: string,
    limit = 5,
  ) {
    if (fileIds.length === 0) return [];

    const [caller] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId));
    const isAdmin = caller?.role === 'admin';

    const [queryEmbedding] = await this.documentsService.embed([query]);
    const similarity = sql<number>`1 - (${cosineDistance(knowledgeChunks.embedding, queryEmbedding)})`;

    // Same tri-state company-scope filter searchAccessibleChunks uses,
    // just constrained to the attached fileIds. Admin gets every
    // company chunk; non-admin needs visibility='all' or membership in
    // a linked team for visibility='teams'. 'admins'-visibility chunks
    // remain off-limits to non-admins regardless of attachment.
    const companyBranch = isAdmin
      ? eq(knowledgeChunks.scope, 'company')
      : or(
          and(
            eq(knowledgeChunks.scope, 'company'),
            eq(knowledgeChunks.visibility, 'all'),
          ),
          and(
            eq(knowledgeChunks.scope, 'company'),
            eq(knowledgeChunks.visibility, 'teams'),
            sql`EXISTS (
              SELECT 1
              FROM ${knowledgeFileTeams} kft
              INNER JOIN ${teamMembers} tm
                ON tm.team_id = kft.team_id
              WHERE kft.file_id = ${knowledgeChunks.fileId}
                AND tm.user_id = ${userId}
                AND tm.status = 'accepted'
            )`,
          ),
        );

    return this.db
      .select({
        id: knowledgeChunks.id,
        fileId: knowledgeChunks.fileId,
        content: knowledgeChunks.content,
        similarity,
      })
      .from(knowledgeChunks)
      .where(
        and(
          inArray(knowledgeChunks.fileId, fileIds),
          or(
            // Personal-scope files attached to a project are still
            // owner-only — attaching doesn't escalate read access.
            and(
              eq(knowledgeChunks.userId, userId),
              eq(knowledgeChunks.scope, 'personal'),
            ),
            companyBranch,
          ),
        ),
      )
      .orderBy(desc(similarity))
      .limit(limit);
  }

  /**
   * Run OpenRouter OCR on a knowledge-file image so the extracted
   * text can flow through the normal chunk + embed pipeline. We
   * resolve the user's OpenRouter key the same way the chat /
   * arena code paths do — so budget gates, lazy provisioning,
   * and the `monthly budget is 0` error message are all consistent
   * with what the user already sees elsewhere.
   *
   * Returns the OCR text (possibly empty when the model can't
   * read the image — the caller flushes that as the "No extractable
   * text" branch). NO_TEXT_FOUND sentinel from the OCR prompt is
   * normalised to empty here so the chunker never sees the marker
   * as content.
   */
  private async extractTextFromImage(
    userId: string,
    buffer: Buffer,
    mimetype: string,
  ): Promise<string> {
    const apiKey = await this.keyResolver.resolveUserKey(userId);
    const client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    });
    const dataUrl = `data:${mimetype};base64,${buffer.toString('base64')}`;
    const completion = await client.chat.completions.create({
      model: OCR_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract ALL text visible in this image, preserving structure and line breaks as best you can. If there is no text, respond with exactly: NO_TEXT_FOUND.',
            },
            {
              type: 'image_url',
              image_url: { url: dataUrl },
            },
          ],
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    if (raw === NO_TEXT_MARKER) return '';
    return raw;
  }

  private inferMimeFromName(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.docx')) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (lower.endsWith('.xlsx')) {
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.txt')) return 'text/plain';
    if (lower.endsWith('.md')) return 'text/markdown';
    if (lower.endsWith('.csv')) return 'text/csv';
    return 'application/octet-stream';
  }
}
