import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';
import type { Pool } from 'pg';
import * as fs from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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
import { GoogleDriveClientService } from '../google-drive/google-drive-client.service.js';
import { OneDriveGraphService } from '../onedrive/onedrive-graph.service.js';
import { SharePointGraphService } from '../sharepoint/sharepoint-graph.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

// Mirror of the constant in OnboardingService — kept inline rather than
// shared so the two modules stay decoupled. If you rename the onboarding
// folder, update both.
const ONBOARDING_FOLDER_NAME = 'Onboarding';

/**
 * Per-file size cap for Drive imports. Matches the import-time cap in
 * DriveImportService (kept duplicated rather than shared to avoid an
 * extra import cycle for two small constants). Both must stay in
 * sync — if you change one, change the other.
 *
 * 50MB matches the existing multer limit on manual uploads.
 */
const MAX_DRIVE_FILE_BYTES = 50 * 1024 * 1024;

/** File sources that come from an external "import" flow (vs. a manual
 *  upload or a single re-ingest). Drives the import-complete notify. */
const IMPORT_SOURCES = new Set(['drive', 'onedrive', 'sharepoint']);

/** Namespace (classid) for the per-user ingestion Postgres advisory lock.
 *  Arbitrary, just has to be stable + not collide with other advisory
 *  locks in the app. Paired with hashtext(userId) as the objid. */
const INGESTION_LOCK_NAMESPACE = 4271;

/** How often the stalled-ingestion reaper runs. */
const REAPER_INTERVAL_MS = 60_000;

/** A `processing` row whose claim is older than this is considered orphaned
 *  (its worker died). Generous vs. real single-file time so a slow-but-alive
 *  job is never reclaimed — and the per-user advisory lock means a live run
 *  holding the lock can't be double-processed even if a reclaim races it. */
const STALE_INGESTION_MS = 15 * 60 * 1000;

/** After this many reclaim attempts a stuck row goes terminal `failed`
 *  instead of looping forever on a poison-pill file. */
const MAX_INGESTION_ATTEMPTS = 3;

/** Reason persisted + notified when the reaper gives up on a poison-pill
 *  row after MAX_INGESTION_ATTEMPTS. Kept as one constant so the DB write
 *  and the notification can't drift apart. */
const RECOVERY_GAVE_UP_MESSAGE =
  'Recovered after a stalled run; gave up after repeated stalls.';

export type IngestionStatus = 'pending' | 'processing' | 'done' | 'failed';

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
export class KnowledgeIngestionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(KnowledgeIngestionService.name);
  /** Timer for the periodic stalled-ingestion reaper. */
  private reaperTimer?: ReturnType<typeof setInterval>;
  // Per-user ingestion concurrency control. Only one background run per
  // user at a time; overlapping triggers set `rerunRequested` so the
  // active run re-scans instead of starting a second loop (which would
  // split tallies + fire duplicate notifications). The import-complete
  // intent is NOT tracked here — it lives on the row (`import_notify`) so
  // it survives a cross-instance / reaper handoff.
  private readonly ingesting = new Set<string>();
  private readonly rerunRequested = new Set<string>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly documentsService: DocumentsService,
    private readonly notifications: NotificationsService,
    // Used by the drive-source branch in ingestOneFile to fetch bytes
    // before parsing. Injected from GoogleDriveModule via the
    // KnowledgeCoreModule import. Not required for upload-source rows.
    private readonly driveClient: GoogleDriveClientService,
    // Same role for source='sharepoint' rows — injected from
    // SharePointModule via KnowledgeCoreModule.
    private readonly sharepointGraph: SharePointGraphService,
    // Same role for source='onedrive' rows — injected from
    // OneDriveModule via KnowledgeCoreModule.
    private readonly onedriveGraph: OneDriveGraphService,
  ) {}

  onModuleInit(): void {
    // Periodic (NOT startup-only) reaper that recovers files orphaned in
    // `processing` by a worker that died mid-ingest. setInterval rather than
    // @nestjs/schedule to avoid pulling in a new dependency for one job.
    // unref() so the timer never keeps the process alive on shutdown/tests.
    this.reaperTimer = setInterval(() => {
      void this.recoverStalledIngestions().catch((err) => {
        this.logger.error(
          'Stalled-ingestion reaper failed',
          err instanceof Error ? err.stack : String(err),
        );
      });
    }, REAPER_INTERVAL_MS);
    this.reaperTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.reaperTimer) clearInterval(this.reaperTimer);
  }

  /**
   * Reclaim files stuck in `processing` because their worker died mid-job
   * (the claim only ever takes `pending`, so nothing else re-picks them).
   * Atomic single UPDATE: a row goes back to `pending` to be retried, or
   * terminal `failed` once it has burned through MAX_INGESTION_ATTEMPTS.
   * Only touches genuinely stale claims (`claimed_at` older than the window,
   * or NULL for rows orphaned before that column existed) so a slow-but-
   * alive job is never reclaimed. Re-triggers ingestion for the affected
   * users; the import-complete notification needs no special handling here —
   * the `import_notify` flag rode along on the row, so the re-drain fires it
   * normally once the recovered file finishes.
   */
  private async recoverStalledIngestions(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_INGESTION_MS);
    const reclaimed = await this.db
      .update(knowledgeFiles)
      .set({
        ingestionStatus: sql`CASE WHEN ${knowledgeFiles.attempts} + 1 >= ${MAX_INGESTION_ATTEMPTS} THEN 'failed' ELSE 'pending' END`,
        attempts: sql`${knowledgeFiles.attempts} + 1`,
        claimedAt: null,
        ingestionError: sql`CASE WHEN ${knowledgeFiles.attempts} + 1 >= ${MAX_INGESTION_ATTEMPTS} THEN ${RECOVERY_GAVE_UP_MESSAGE} ELSE ${knowledgeFiles.ingestionError} END`,
        ingestionCompletedAt: sql`CASE WHEN ${knowledgeFiles.attempts} + 1 >= ${MAX_INGESTION_ATTEMPTS} THEN now() ELSE ${knowledgeFiles.ingestionCompletedAt} END`,
      })
      .where(
        and(
          eq(knowledgeFiles.ingestionStatus, 'processing'),
          or(
            isNull(knowledgeFiles.claimedAt),
            lt(knowledgeFiles.claimedAt, cutoff),
          ),
        ),
      )
      .returning({
        id: knowledgeFiles.id,
        name: knowledgeFiles.name,
        status: knowledgeFiles.ingestionStatus,
        userId: knowledgeFiles.uploadedById,
      });

    if (reclaimed.length === 0) return;
    this.logger.warn(
      `Recovered ${reclaimed.length} stalled ingestion file(s): ${reclaimed
        .map((r) => `${r.name} → ${r.status}`)
        .join(', ')}`,
    );

    // Re-drain each user whose files went back to `pending`. The
    // import-complete notification rides on the row's `import_notify` flag,
    // so a plain trigger is enough — drainUserQueue fires it once the
    // recovered file finishes. Terminal `failed` rows get the per-file
    // failure notice instead.
    const pendingUsers = new Set<string>();
    for (const r of reclaimed) {
      if (!r.userId) continue;
      if (r.status === 'pending') {
        pendingUsers.add(r.userId);
      } else {
        await this.notifyIngestionFailure(
          r.userId,
          r.id,
          r.name,
          RECOVERY_GAVE_UP_MESSAGE,
        );
      }
    }
    for (const userId of pendingUsers) {
      this.ingestPendingFilesForUser(userId);
    }
  }

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
  ingestPendingFilesForUser(
    userId: string,
    opts?: { fromImport?: boolean },
  ): void {
    // Flag this import's not-yet-finished files so the drain fires the
    // import-complete notification when the last one lands. Persisted on the
    // row (not in-memory) so it survives a cross-instance / reaper handoff.
    // Fire-and-forget but kicked before the run below, so it's set well
    // before any file finishes (a single UPDATE vs. download+parse+embed).
    if (opts?.fromImport) {
      void this.markImportNotify(userId);
    }

    // One run per user: if a run is already draining, just ask it to
    // re-scan for the rows we added (its loop polls until empty) rather
    // than starting a concurrent loop.
    if (this.ingesting.has(userId)) {
      this.rerunRequested.add(userId);
      return;
    }

    this.ingesting.add(userId);
    void this.runUserFileIngestion(userId)
      .catch((err) => {
        this.logger.error(
          `Background file ingestion crashed for user ${userId}`,
          err instanceof Error ? err.stack : String(err),
        );
      })
      .finally(() => {
        this.ingesting.delete(userId);
        // A trigger that landed in the gap after the run's final re-scan
        // check would otherwise be stranded — start a fresh run for it.
        if (this.rerunRequested.delete(userId)) {
          this.ingestPendingFilesForUser(userId);
        }
      });
  }

  /**
   * Flag the caller's not-yet-finished import files (`pending`/`processing`,
   * import source) so the drain knows to fire the import-complete
   * notification when they all reach a terminal state. Idempotent. Persisted
   * on the row so the intent survives across instances and a reaper handoff.
   */
  private async markImportNotify(userId: string): Promise<void> {
    try {
      await this.db
        .update(knowledgeFiles)
        .set({ importNotify: true })
        .where(
          and(
            eq(knowledgeFiles.uploadedById, userId),
            inArray(knowledgeFiles.source, [...IMPORT_SOURCES]),
            inArray(knowledgeFiles.ingestionStatus, ['pending', 'processing']),
          ),
        );
    } catch (err) {
      this.logger.error(
        `Failed to flag import-notify for user ${userId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Serialize ingestion across processes with a per-user Postgres
   * advisory lock (held on a dedicated pooled connection so the unlock
   * runs on the same session). The in-memory `ingesting` Set already
   * dedupes within this process; this guards multi-instance deploys
   * where two API instances could otherwise each drain the same user's
   * queue and fire duplicate / split completion notifications. If the
   * lock is held elsewhere we skip — the holder polls `pending` and will
   * drain the rows we just added too.
   */
  private async runUserFileIngestion(userId: string): Promise<void> {
    // drizzle's node-postgres driver exposes the underlying pool on
    // `$client`; the typed Database alias doesn't surface it, hence the cast.
    const pool = (this.db as unknown as { $client: Pool }).$client;
    const lockClient = await pool.connect();
    let locked = false;
    try {
      const res = await lockClient.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked',
        [INGESTION_LOCK_NAMESPACE, userId],
      );
      locked = res.rows[0]?.locked === true;
      if (!locked) {
        this.logger.log(
          `Ingestion already running for user ${userId} on another instance; skipping (holder will drain the queue).`,
        );
        return;
      }
      await this.drainUserQueue(userId);
    } finally {
      if (locked) {
        try {
          await lockClient.query(
            'SELECT pg_advisory_unlock($1, hashtext($2))',
            [INGESTION_LOCK_NAMESPACE, userId],
          );
        } catch {
          // best-effort — the lock also releases when the session ends
        }
      }
      lockClient.release();
    }
  }

  private async drainUserQueue(userId: string): Promise<void> {
    // Process pending files in small batches so the FE shows a clear
    // queue progression ("Queued" → "Adding" → "In context") instead
    // of flipping every file to "Adding" at once. Each iteration claims
    // INGESTION_BATCH_SIZE rows atomically via a subquery, processes
    // them sequentially, then loops to pick up the next batch. Remaining
    // files stay 'pending' ("Queued") until their turn.
    const INGESTION_BATCH_SIZE = 5;

    // Outer loop absorbs concurrent triggers: a trigger that lands while
    // this run is active sets `rerunRequested` instead of starting a
    // second loop, so all rows go through ONE run with ONE notification.
    do {
      this.rerunRequested.delete(userId);

      while (true) {
        // Atomic claim: SELECT … LIMIT N inside the WHERE so only
        // INGESTION_BATCH_SIZE rows transition pending→processing per round.
        const claimed = await this.db
          .update(knowledgeFiles)
          // Stamp the claim so the reaper can tell a live worker (fresh
          // claimed_at) from a dead one (stale / NULL).
          .set({ ingestionStatus: 'processing', claimedAt: new Date() })
          .where(
            inArray(
              knowledgeFiles.id,
              this.db
                .select({ id: knowledgeFiles.id })
                .from(knowledgeFiles)
                .where(
                  and(
                    eq(knowledgeFiles.uploadedById, userId),
                    eq(knowledgeFiles.ingestionStatus, 'pending'),
                  ),
                )
                .orderBy(desc(knowledgeFiles.createdAt))
                .limit(INGESTION_BATCH_SIZE),
            ),
          )
          .returning({
            id: knowledgeFiles.id,
            storagePath: knowledgeFiles.storagePath,
            name: knowledgeFiles.name,
            scope: knowledgeFiles.scope,
            visibility: knowledgeFiles.visibility,
            source: knowledgeFiles.source,
            externalId: knowledgeFiles.externalId,
            externalDriveId: knowledgeFiles.externalDriveId,
          });

        if (claimed.length === 0) break;

        for (const file of claimed) {
          await this.ingestOneFile(userId, file);
        }
      }
    } while (this.rerunRequested.has(userId));

    await this.fireImportCompleteIfDone(userId);
  }

  /**
   * Fire the import-complete notification iff every file flagged with
   * `import_notify` for this user has reached a terminal state. DB-driven and
   * atomic: the single UPDATE clears the flags only when none are still
   * pending/processing, and RETURNING tells exactly one instance it won the
   * notification (a racing instance's UPDATE matches nothing once the flags
   * are cleared). Counts come from the DB, so a recovered-late file is
   * counted correctly and the notification never fires twice. Best-effort.
   */
  private async fireImportCompleteIfDone(userId: string): Promise<void> {
    try {
      const completed = await this.db
        .update(knowledgeFiles)
        .set({ importNotify: false })
        .where(
          and(
            eq(knowledgeFiles.uploadedById, userId),
            eq(knowledgeFiles.importNotify, true),
            // Hold until the whole flagged batch is terminal — a single file
            // still pending/processing (incl. one a reaper just re-queued)
            // keeps the notification armed.
            sql`NOT EXISTS (
              SELECT 1 FROM ${knowledgeFiles} k2
              WHERE k2.uploaded_by_id = ${userId}
                AND k2.import_notify = true
                AND k2.ingestion_status IN ('pending', 'processing')
            )`,
          ),
        )
        .returning({ status: knowledgeFiles.ingestionStatus });

      if (completed.length === 0) return;
      const added = completed.filter((r) => r.status === 'done').length;
      await this.notifyImportComplete(userId, added, completed.length - added);
    } catch (err) {
      this.logger.error(
        `Failed to evaluate import-complete for user ${userId}`,
        err instanceof Error ? err.stack : String(err),
      );
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
      source: string;
      externalId: string | null;
      externalDriveId: string | null;
    },
  ): Promise<'done' | 'failed'> {
    try {
      // Drive-source rows arrive with storagePath=null — the import
      // endpoint inserts metadata only, then we download here. We
      // persist the storagePath + sizeBytes back on the row so the
      // user can download/re-ingest later without another Drive call.
      if (file.source === 'drive' && !file.storagePath) {
        if (!file.externalId) {
          throw new Error(
            'Drive-source file is missing externalId; cannot download.',
          );
        }
        const storagePath = await this.fetchDriveBytes(userId, file);
        // Resolve actual byte size now that the file is on disk —
        // Drive doesn't report reliable sizes for native formats before
        // export, so we update sizeBytes here to keep folder totals accurate.
        const { size: actualBytes } = await fs.promises.stat(
          resolve(process.cwd(), storagePath),
        );
        await this.db
          .update(knowledgeFiles)
          .set({ storagePath, sizeBytes: actualBytes })
          .where(eq(knowledgeFiles.id, file.id));
        file.storagePath = storagePath;
      }

      // Same pattern for SharePoint-source rows. Graph item ids alone
      // aren't enough to download — we need (driveId, itemId), so the
      // import path persists driveId as `externalDriveId` on the row.
      if (file.source === 'sharepoint' && !file.storagePath) {
        if (!file.externalId || !file.externalDriveId) {
          throw new Error(
            'SharePoint-source file is missing externalId or externalDriveId; cannot download.',
          );
        }
        const storagePath = await this.fetchSharePointBytes(userId, file);
        const { size: actualBytes } = await fs.promises.stat(
          resolve(process.cwd(), storagePath),
        );
        await this.db
          .update(knowledgeFiles)
          .set({ storagePath, sizeBytes: actualBytes })
          .where(eq(knowledgeFiles.id, file.id));
        file.storagePath = storagePath;
      }

      // Same pattern for OneDrive-source rows. OneDrive is single-drive
      // per user (/me/drive), so itemId alone is enough — no
      // externalDriveId needed (it stays NULL for OneDrive rows).
      if (file.source === 'onedrive' && !file.storagePath) {
        if (!file.externalId) {
          throw new Error(
            'OneDrive-source file is missing externalId; cannot download.',
          );
        }
        const storagePath = await this.fetchOneDriveBytes(userId, file);
        const { size: actualBytes } = await fs.promises.stat(
          resolve(process.cwd(), storagePath),
        );
        await this.db
          .update(knowledgeFiles)
          .set({ storagePath, sizeBytes: actualBytes })
          .where(eq(knowledgeFiles.id, file.id));
        file.storagePath = storagePath;
      }

      if (!file.storagePath) {
        throw new Error('File has no storage path on disk');
      }
      const absolutePath = resolve(process.cwd(), file.storagePath);
      const buffer = await readFile(absolutePath);

      // Knowledge Core uploads don't store mimetype on the row; infer
      // from the filename. Everything routes through
      // DocumentsService.parseFile (PDF, DOCX, XLSX, TXT, MD, CSV).
      // Unsupported types throw and land in the catch block below,
      // which marks the row 'failed' with the parser's message so
      // the FE renders a "Skipped" badge.
      const mimetype = this.inferMimeFromName(file.name);
      const text = await this.documentsService.parseFile(buffer, mimetype);
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
        return 'failed';
      }

      const embeddings = await this.documentsService.embed(chunks);

      await this.db.transaction(async (tx) => {
        // Idempotent (re)ingest: clear any chunks left by a prior partial
        // run before inserting, so a reaper-reclaimed file — or any
        // re-process — never duplicates chunks for the same file_id.
        await tx
          .delete(knowledgeChunks)
          .where(eq(knowledgeChunks.fileId, file.id));
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
      return 'done';
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
      return 'failed';
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
   * Notify the user that a Drive / OneDrive / SharePoint import finished
   * ingesting. Fired once per background run after the whole pending
   * queue drains, so it lands even if the user navigated away mid-import.
   * Best-effort — never throws.
   */
  private async notifyImportComplete(
    userId: string,
    added: number,
    failed: number,
  ): Promise<void> {
    try {
      const body =
        failed > 0
          ? `${added} file${added === 1 ? '' : 's'} added to Knowledge Core, ${failed} couldn't be processed.`
          : `${added} file${added === 1 ? '' : 's'} added to Knowledge Core.`;
      await this.notifications.create({
        userId,
        type: 'knowledge_import_complete',
        title: 'Import complete',
        body,
        data: { added, failed },
      });
    } catch {
      // swallow — best-effort
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
    // there. One round-trip to read role + companyId; uploads
    // aren't a hot path, but chat-time RAG runs on every prompt —
    // keeping this a single SELECT per call is intentional.
    //
    // Tenant key is `companyId` (UUID). Without it the query
    // previously leaked chunks across tenants — the original code
    // assumed single-tenant ("scope='company' == org-wide"); the
    // earlier patch switched to `company_name` which still leaks
    // between two tenants that happen to share a display name.
    // Comparing UUIDs cleanly isolates them.
    const [caller] = await this.db
      .select({ role: users.role, companyId: users.companyId })
      .from(users)
      .where(eq(users.id, userId));
    const isAdmin = caller?.role === 'admin';
    const callerCompanyId = caller?.companyId ?? null;

    const [queryEmbedding] = await this.documentsService.embed([query]);
    const similarity = sql<number>`1 - (${cosineDistance(knowledgeChunks.embedding, queryEmbedding)})`;

    // Company-scope filter — four-state:
    //   - 'all'     : every company user including admin
    //   - 'admins'  : admin caller only
    //   - 'teams'   : admin OR accepted member of one of the linked
    //                 teams
    //   - 'project' : NEVER reached by this org-wide path; project-
    //                 only chunks are surfaced exclusively via
    //                 searchProjectAttachedChunks inside that
    //                 project's chat. Excluded even for admin.
    //
    // The teams branch probes via EXISTS against the join table.
    // Indexes on knowledge_file_teams (file_id) and team_members
    // (user_id, status) keep this sub-millisecond per chunk.
    // Cross-tenant isolation guard: chunk is in caller's tenant
    // iff its file's uploader shares caller.companyId. NULL
    // companyId (personal-profile caller) collapses to FALSE so
    // a personal user never sees ANY company-scope chunks.
    const sameCompanyAsCaller = callerCompanyId
      ? sql`EXISTS (
          SELECT 1
          FROM ${knowledgeFiles} kf
          INNER JOIN ${users} uploader ON uploader.id = kf.uploaded_by_id
          WHERE kf.id = ${knowledgeChunks.fileId}
            AND uploader.company_id = ${callerCompanyId}
        )`
      : sql`FALSE`;

    const companyBranch = isAdmin
      ? and(
          eq(knowledgeChunks.scope, 'company'),
          sql`${knowledgeChunks.visibility} <> 'project'`,
          sameCompanyAsCaller,
        )
      : or(
          and(
            eq(knowledgeChunks.scope, 'company'),
            eq(knowledgeChunks.visibility, 'all'),
            sameCompanyAsCaller,
          ),
          and(
            eq(knowledgeChunks.scope, 'company'),
            eq(knowledgeChunks.visibility, 'teams'),
            sameCompanyAsCaller,
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
      .select({ role: users.role, companyId: users.companyId })
      .from(users)
      .where(eq(users.id, userId));
    const isAdmin = caller?.role === 'admin';
    const callerCompanyId = caller?.companyId ?? null;

    const [queryEmbedding] = await this.documentsService.embed([query]);
    const similarity = sql<number>`1 - (${cosineDistance(knowledgeChunks.embedding, queryEmbedding)})`;

    // Cross-tenant isolation (same guard as searchAccessibleChunks):
    // even when a file is attached to a project the caller belongs
    // to, the chunk only counts if the uploader shares the caller's
    // `companyId`. Prevents a personal-profile user (no companyId)
    // from seeing any company-scope content via project attach, and
    // keeps two same-name tenants from leaking into each other.
    const sameCompanyAsCaller = callerCompanyId
      ? sql`EXISTS (
          SELECT 1
          FROM ${knowledgeFiles} kf
          INNER JOIN ${users} uploader ON uploader.id = kf.uploaded_by_id
          WHERE kf.id = ${knowledgeChunks.fileId}
            AND uploader.company_id = ${callerCompanyId}
        )`
      : sql`FALSE`;

    // Visibility filter constrained to the attached fileIds:
    //   - admin: any company chunk (admins-only / teams / project all
    //     OK; project files are by definition attached or wouldn't
    //     be in fileIds)
    //   - non-admin: visibility='all'; OR visibility='teams' AND
    //     member of a linked team; OR visibility='project' (no
    //     further check — being in fileIds means the file is in
    //     project_knowledge_files, which is the access grant for
    //     project visibility). 'admins'-visibility stays off-limits.
    const companyBranch = isAdmin
      ? and(eq(knowledgeChunks.scope, 'company'), sameCompanyAsCaller)
      : or(
          and(
            eq(knowledgeChunks.scope, 'company'),
            eq(knowledgeChunks.visibility, 'all'),
            sameCompanyAsCaller,
          ),
          and(
            eq(knowledgeChunks.scope, 'company'),
            eq(knowledgeChunks.visibility, 'teams'),
            sameCompanyAsCaller,
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
          and(
            eq(knowledgeChunks.scope, 'company'),
            eq(knowledgeChunks.visibility, 'project'),
            sameCompanyAsCaller,
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
   * Full text of files attached to the *current message*, for DIRECT
   * injection into the chat context (ChatGPT-style "the model sees the
   * file you just attached"). Differs from searchProjectAttachedChunks:
   *   - NOT gated on a semantic query — the whole file is included so a
   *     bare "summarize this" prompt still works.
   *   - NOT gated on ingestion finishing — if the async pipeline hasn't
   *     produced chunks yet, we parse the file from disk on the spot.
   * Restricted to files the caller OWNS (uploadedById === userId); any
   * non-owned file simply yields nothing here and still flows through
   * the access-checked semantic path.
   */
  async getOwnedAttachedFilesText(
    userId: string,
    fileIds: string[],
    perFileCharCap = 12000,
  ): Promise<{ fileId: string; name: string; text: string }[]> {
    if (fileIds.length === 0) return [];
    const files = await this.db
      .select({
        id: knowledgeFiles.id,
        name: knowledgeFiles.name,
        storagePath: knowledgeFiles.storagePath,
      })
      .from(knowledgeFiles)
      .where(
        and(
          inArray(knowledgeFiles.id, fileIds),
          eq(knowledgeFiles.uploadedById, userId),
        ),
      );

    const out: { fileId: string; name: string; text: string }[] = [];
    for (const f of files) {
      let text = '';
      // Prefer already-ingested chunks (no disk read).
      const chunks = await this.db
        .select({ content: knowledgeChunks.content })
        .from(knowledgeChunks)
        .where(eq(knowledgeChunks.fileId, f.id))
        .orderBy(asc(knowledgeChunks.chunkIndex));
      if (chunks.length > 0) {
        text = chunks.map((c) => c.content).join('\n');
      } else if (f.storagePath) {
        // Not ingested yet — parse synchronously so the model sees the
        // file on the very first message after attaching.
        try {
          const buffer = await readFile(resolve(process.cwd(), f.storagePath));
          text = await this.documentsService.parseFile(
            buffer,
            this.inferMimeFromName(f.name),
          );
        } catch (err) {
          this.logger.warn(
            `Attached file ${f.id} (${f.name}) could not be read for direct injection: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      text = text.trim();
      if (text) {
        out.push({
          fileId: f.id,
          name: f.name,
          text:
            text.length > perFileCharCap ? text.slice(0, perFileCharCap) : text,
        });
      }
    }
    return out;
  }

  /**
   * Pull a Drive-source file's bytes via the Drive client, write
   * them to a deterministic path under `uploads/knowledge-core/drive/`,
   * and return the relative storagePath the row should record.
   *
   * The basename is the row's UUID so we never collide with a manual
   * upload (those live one directory up under `uploads/knowledge-core/`
   * with multer-generated `<rand>-<safe-name>` basenames). Existing
   * file on disk is silently overwritten — the only way to get here
   * twice for the same row is an explicit re-ingest, which intends
   * to refresh.
   *
   * Size cap belt-and-braces: DriveImportService strips files larger
   * than this BEFORE inserting a KC row, but Google native formats
   * (Doc/Sheet/Slide) report sizeBytes=null from Drive and slip past
   * the import-time check — they get caught here post-export. The
   * surrounding try/catch persists the message as ingestion_error so
   * the user can see why a particular file was skipped.
   */
  private async fetchDriveBytes(
    userId: string,
    file: { id: string; name: string; externalId: string | null },
  ): Promise<string> {
    if (!file.externalId) {
      throw new Error('Drive-source file is missing externalId');
    }
    const download = await this.driveClient.downloadFile(
      userId,
      file.externalId,
    );
    if (download.buffer.length > MAX_DRIVE_FILE_BYTES) {
      const mb = (download.buffer.length / (1024 * 1024)).toFixed(1);
      throw new Error(
        `File is ${mb}MB — Drive imports are capped at ${MAX_DRIVE_FILE_BYTES / (1024 * 1024)}MB per file. Skipped.`,
      );
    }
    const ext = this.extFromName(file.name);
    const storagePath = `uploads/knowledge-core/drive/${file.id}${ext}`;
    const absolutePath = resolve(process.cwd(), storagePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, download.buffer);
    return storagePath;
  }

  /**
   * Same role as fetchDriveBytes for SharePoint-source rows. Graph's
   * pre-authenticated download URL is fetched at download time (URLs
   * expire after ~1h), then the bytes are written under
   * `uploads/knowledge-core/sharepoint/`.
   *
   * Re-applies the 50 MB cap belt-and-braces — SharePoint reports
   * size up-front in the listing, so this is mostly redundant, but
   * the cost is one buffer.length comparison.
   */
  private async fetchSharePointBytes(
    userId: string,
    file: {
      id: string;
      name: string;
      externalId: string | null;
      externalDriveId: string | null;
    },
  ): Promise<string> {
    if (!file.externalId || !file.externalDriveId) {
      throw new Error(
        'SharePoint-source file is missing externalId or externalDriveId',
      );
    }
    const download = await this.sharepointGraph.downloadFile(
      userId,
      file.externalDriveId,
      file.externalId,
    );
    if (download.buffer.length > MAX_DRIVE_FILE_BYTES) {
      const mb = (download.buffer.length / (1024 * 1024)).toFixed(1);
      throw new Error(
        `File is ${mb}MB — SharePoint imports are capped at ${MAX_DRIVE_FILE_BYTES / (1024 * 1024)}MB per file. Skipped.`,
      );
    }
    const ext = this.extFromName(file.name);
    const storagePath = `uploads/knowledge-core/sharepoint/${file.id}${ext}`;
    const absolutePath = resolve(process.cwd(), storagePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, download.buffer);
    return storagePath;
  }

  /**
   * Same role as fetchDriveBytes for OneDrive-source rows.
   * `/me/drive/items/{itemId}` exposes a short-lived
   * @microsoft.graph.downloadUrl that we hit without auth header
   * (URL is pre-authenticated). Single-drive structure means no
   * external_drive_id is needed (kept NULL on OneDrive rows).
   */
  private async fetchOneDriveBytes(
    userId: string,
    file: { id: string; name: string; externalId: string | null },
  ): Promise<string> {
    if (!file.externalId) {
      throw new Error('OneDrive-source file is missing externalId');
    }
    const download = await this.onedriveGraph.downloadFile(
      userId,
      file.externalId,
    );
    if (download.buffer.length > MAX_DRIVE_FILE_BYTES) {
      const mb = (download.buffer.length / (1024 * 1024)).toFixed(1);
      throw new Error(
        `File is ${mb}MB — OneDrive imports are capped at ${MAX_DRIVE_FILE_BYTES / (1024 * 1024)}MB per file. Skipped.`,
      );
    }
    const ext = this.extFromName(file.name);
    const storagePath = `uploads/knowledge-core/onedrive/${file.id}${ext}`;
    const absolutePath = resolve(process.cwd(), storagePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, download.buffer);
    return storagePath;
  }

  private extFromName(filename: string): string {
    const dot = filename.lastIndexOf('.');
    if (dot === -1 || dot === filename.length - 1) return '';
    return filename.slice(dot).toLowerCase();
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
    if (lower.endsWith('.txt')) return 'text/plain';
    if (lower.endsWith('.md')) return 'text/markdown';
    if (lower.endsWith('.csv')) return 'text/csv';
    return 'application/octet-stream';
  }
}
