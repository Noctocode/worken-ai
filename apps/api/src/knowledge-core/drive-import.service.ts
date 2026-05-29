import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  driveImportSources,
  knowledgeFileTeams,
  knowledgeFiles,
  knowledgeFolders,
  projectKnowledgeFiles,
  users,
} from '@worken/database/schema';
import { UPLOAD_ALLOWED_EXTENSIONS } from './upload-allowlist.js';

import { DATABASE, type Database } from '../database/database.module.js';
import {
  GoogleDriveClientService,
  type DriveFileMeta,
} from '../google-drive/google-drive-client.service.js';
import { GoogleDriveOAuthService } from '../google-drive/google-drive-oauth.service.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';

/**
 * The KC parent folder Drive imports nest under. "Entire Drive"
 * imports land directly inside this folder; folder-scoped imports
 * each get their own child folder named exactly after the Drive
 * source (e.g. "Google Drive > Test"). Lazily created on first
 * import so users who never touch Drive don't carry around an empty
 * parent folder.
 */
const DRIVE_PARENT_FOLDER_NAME = 'Google Drive';

/**
 * Per-import safety cap for folder-scoped imports. Folder picks are
 * typically narrow; we keep a tighter ceiling to prevent an accidental
 * "select all" from overwhelming the ingestion queue.
 */
const MAX_FOLDER_IMPORT_FILES = 1000;

/**
 * Higher cap for "Entire Drive" imports. The FE shows an explicit
 * confirmation step (file-count warning + checkbox) before the user
 * can trigger this path, so the risk of an accidental mass-import is
 * low. Still capped to protect against runaway ingestion.
 */
const MAX_ALL_IMPORT_FILES = 10_000;

/**
 * Per-file size cap. Matches the existing 50MB multer limit on
 * manual uploads — without this, the Drive path bypasses that limit
 * and could download GB-sized binaries straight into a Node Buffer
 * (process OOM). Native Google formats (Docs/Sheets/Slides) report
 * sizeBytes=null from Drive, so they get a post-download check in
 * KnowledgeIngestionService.fetchDriveBytes instead.
 */
const MAX_DRIVE_FILE_BYTES = 50 * 1024 * 1024;

export type DriveVisibility = 'all' | 'admins' | 'teams' | 'project';

export type ImportScope = (
  | { kind: 'all' }
  | { kind: 'folders'; folderIds: string[] }
) & {
  visibility?: DriveVisibility;
  teamIds?: string[];
  projectIds?: string[];
};

export interface ImportResult {
  /** Number of new knowledge_files rows created on this call. */
  added: number;
  /** Files Drive returned that we already had (matched by external_id). */
  skippedDuplicates: number;
  /** Files Drive returned with a MIME we can't ingest. */
  skippedUnsupported: number;
  /**
   * Files skipped at import time because Drive reported a size above
   * MAX_DRIVE_FILE_BYTES. Native Google formats (size unknown until
   * export) get a separate post-download check that lands in
   * ingestion_error on the row, not in this counter.
   */
  skippedTooLarge: number;
  /** Source rows touched by this import (created or re-synced). */
  sources: { id: string; driveFolderName: string }[];
}

export interface DriveSourceRow {
  id: string;
  scope: 'all' | 'folder';
  driveFolderId: string | null;
  driveFolderName: string;
  lastSyncedAt: string;
  fileCountAtLastSync: number;
  createdAt: string;
}

/** Progress snapshot returned to the FE while an async import runs. */
export interface DriveImportProgress {
  phase: 'scanning' | 'importing' | 'done' | 'cancelled' | 'error';
  /** Files seen during the Drive list-API phase. */
  scanned: number;
  /**
   * New files ready to insert after filtering + dedup.
   * Zero until the scanning phase completes.
   */
  total: number;
  /** Rows inserted into knowledge_files so far. */
  imported: number;
  /** Set when phase='error'. */
  error?: string;
}

/** Internal only — tracks a running background import for one user. */
interface ActiveImportJob {
  progress: DriveImportProgress;
  /** Set to true by cancelImport() to stop the loop at the next checkpoint. */
  cancelled: boolean;
  /** IDs of knowledge_files rows inserted by this job (for rollback on cancel). */
  insertedFileIds: string[];
  /** drive_import_sources row created by this job; null if an existing row was re-used. */
  createdSourceId: string | null;
}

/** Thrown from the onProgress callback to abort a Drive scan mid-flight. */
class ImportCancelledError extends Error {
  constructor() {
    super('Import cancelled by user');
  }
}

@Injectable()
export class DriveImportService {
  private readonly logger = new Logger(DriveImportService.name);

  /** One entry per user who currently has a background import in progress. */
  private readonly activeJobs = new Map<string, ActiveImportJob>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly oauth: GoogleDriveOAuthService,
    private readonly drive: GoogleDriveClientService,
    private readonly ingestion: KnowledgeIngestionService,
  ) {}

  /**
   * Import (or Re-sync if the same scope was imported before) files
   * from the user's connected Drive into KC. Files Drive returns that
   * we already have (matched by `(uploaded_by_id, external_id)`) are
   * skipped — Re-sync is just "add new files since last time", never
   * a delete or re-ingest.
   *
   * Native Google formats (Docs / Sheets / Slides) are auto-converted
   * by the Drive client; unsupported MIMEs (videos, etc.) are skipped
   * up-front with a count returned to the FE.
   *
   * Imported rows go into a single auto-folder ("Google Drive") inside
   * KC. The Drive folder structure isn't mirrored — too much friction
   * vs. value for the MVP; users can reorganise via existing KC.
   */
  async importFromDrive(
    userId: string,
    scope: ImportScope,
  ): Promise<ImportResult> {
    // Validate scope shape first so we fail fast on bad input.
    if (
      scope.kind === 'folders' &&
      (!Array.isArray(scope.folderIds) || scope.folderIds.length === 0)
    ) {
      throw new BadRequestException(
        'folderIds must be a non-empty array when scope is "folders".',
      );
    }

    // Validate visibility + its dependent fields.
    const VALID_VISIBILITIES: DriveVisibility[] = [
      'all',
      'admins',
      'teams',
      'project',
    ];
    if (
      scope.visibility !== undefined &&
      !VALID_VISIBILITIES.includes(scope.visibility)
    ) {
      throw new BadRequestException(
        `Invalid visibility "${scope.visibility}". Must be one of: ${VALID_VISIBILITIES.join(', ')}.`,
      );
    }
    if (
      scope.visibility === 'teams' &&
      (!Array.isArray(scope.teamIds) || scope.teamIds.length === 0)
    ) {
      throw new BadRequestException(
        'teamIds must be a non-empty array when visibility is "teams".',
      );
    }
    if (
      scope.visibility === 'project' &&
      (!Array.isArray(scope.projectIds) || scope.projectIds.length === 0)
    ) {
      throw new BadRequestException(
        'projectIds must be a non-empty array when visibility is "project".',
      );
    }

    const connection = await this.oauth.requireConnection(userId);

    // Resolve (or create) the "Google Drive" parent folder. Children
    // for per-folder imports are nested under this; entire-Drive
    // imports go directly inside it.
    const driveParentFolderId = await this.ensureDriveParentFolder(userId);

    // Hydrate per-user metadata once (used by every inserted row).
    const [uploader] = await this.db
      .select({ profileType: users.profileType })
      .from(users)
      .where(eq(users.id, userId));
    const fileScope =
      uploader?.profileType === 'company' ? 'company' : 'personal';

    const result: ImportResult = {
      added: 0,
      skippedDuplicates: 0,
      skippedUnsupported: 0,
      skippedTooLarge: 0,
      sources: [],
    };

    if (scope.kind === 'all') {
      const files = await this.drive.listFiles(
        userId,
        { kind: 'all' },
        MAX_ALL_IMPORT_FILES + 1,
      );
      this.enforceImportCountCap(files.length, 'all');
      // Entire-Drive import lands DIRECTLY in the "Google Drive"
      // parent — no child folder, since there's no single Drive
      // folder to name the child after.
      const inserted = await this.upsertFilesAndSource(userId, {
        files,
        sourceScope: 'all',
        driveFolderId: null,
        driveFolderName: 'My Drive',
        connectionId: connection.id,
        kcFolderId: driveParentFolderId,
        kcFileScope: fileScope,
        visibility: scope.visibility,
        teamIds: scope.teamIds,
        projectIds: scope.projectIds,
      });
      result.added += inserted.added;
      result.skippedDuplicates += inserted.skippedDuplicates;
      result.skippedTooLarge += inserted.skippedTooLarge;
      result.skippedUnsupported += inserted.skippedUnsupported;
      result.sources.push({
        id: inserted.sourceId,
        driveFolderName: 'My Drive',
      });
    } else {
      // Aggregate count across all picked folders so a "20 small
      // folders" pick doesn't quietly bypass the per-import cap.
      // First pass: tally Drive files across every folder, then run
      // the cap check once before any database writes.
      const perFolder: {
        folderId: string;
        folderName: string;
        files: DriveFileMeta[];
      }[] = [];
      let totalFiles = 0;
      for (const folderId of scope.folderIds) {
        const folderName = await this.resolveDriveFolderName(userId, folderId);
        const files = await this.drive.listFiles(
          userId,
          { kind: 'folders', folderIds: [folderId] },
          MAX_FOLDER_IMPORT_FILES + 1,
        );
        perFolder.push({ folderId, folderName, files });
        totalFiles += files.length;
      }
      this.enforceImportCountCap(totalFiles, 'folders');

      for (const entry of perFolder) {
        // Per-folder imports get their own KC child under
        // "Google Drive", named exactly like the Drive folder so
        // multiple Drive sources don't pile into one bucket.
        // Re-imports of the same folder reuse the existing child.
        const kcChildFolderId = await this.ensureChildFolder(
          userId,
          driveParentFolderId,
          entry.folderName,
        );
        const inserted = await this.upsertFilesAndSource(userId, {
          files: entry.files,
          sourceScope: 'folder',
          driveFolderId: entry.folderId,
          driveFolderName: entry.folderName,
          connectionId: connection.id,
          kcFolderId: kcChildFolderId,
          kcFileScope: fileScope,
          visibility: scope.visibility,
          teamIds: scope.teamIds,
          projectIds: scope.projectIds,
        });
        result.added += inserted.added;
        result.skippedDuplicates += inserted.skippedDuplicates;
        result.skippedTooLarge += inserted.skippedTooLarge;
        result.skippedUnsupported += inserted.skippedUnsupported;
        result.sources.push({
          id: inserted.sourceId,
          driveFolderName: entry.folderName,
        });
      }
    }

    await this.oauth.markSynced(userId);

    // Kick off ingestion for the newly-inserted pending rows. The
    // existing fire-and-forget worker picks up everything with
    // ingestion_status='pending' for this user — Drive-source rows
    // will hit the new download branch in KnowledgeIngestionService.
    if (result.added > 0) {
      this.ingestion.ingestPendingFilesForUser(userId);
    }

    return result;
  }

  /**
   * Re-sync a single existing source. Returns the same shape as
   * importFromDrive — same code path under the hood. Idempotent: if
   * Drive returns the same files we already have, `added` is 0.
   */
  async resyncSource(userId: string, sourceId: string): Promise<ImportResult> {
    const [source] = await this.db
      .select()
      .from(driveImportSources)
      .where(
        and(
          eq(driveImportSources.id, sourceId),
          eq(driveImportSources.ownerId, userId),
        ),
      );
    if (!source) throw new NotFoundException('Drive source not found');

    // Reproduce the original visibility settings so newly-added files
    // match whatever the user picked on the initial import. Without
    // this, re-sync would silently default new files to 'all', which
    // would be surprising for a source originally scoped to a team.
    const visibilityExtras = {
      visibility: (source.visibility as DriveVisibility) ?? undefined,
      teamIds: source.teamIds ?? undefined,
      projectIds: source.projectIds ?? undefined,
    };

    if (source.scope === 'all') {
      return this.importFromDrive(userId, { kind: 'all', ...visibilityExtras });
    }
    if (!source.driveFolderId) {
      throw new BadRequestException(
        'Folder-scoped source is missing its Drive folder id; remove and re-import.',
      );
    }
    return this.importFromDrive(userId, {
      kind: 'folders',
      folderIds: [source.driveFolderId],
      ...visibilityExtras,
    });
  }

  /**
   * List a user's imported Drive sources for the FE Re-sync UI.
   * Ordered by most-recently synced first so the chip the user just
   * clicked stays at the top.
   */
  async listSources(userId: string): Promise<DriveSourceRow[]> {
    const rows = await this.db
      .select()
      .from(driveImportSources)
      .where(eq(driveImportSources.ownerId, userId))
      .orderBy(sql`${driveImportSources.lastSyncedAt} DESC`);
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope as 'all' | 'folder',
      driveFolderId: r.driveFolderId,
      driveFolderName: r.driveFolderName,
      lastSyncedAt: r.lastSyncedAt.toISOString(),
      fileCountAtLastSync: r.fileCountAtLastSync,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Delete the source record. Imported files are NOT touched — the
   * user removes those via the normal KC delete path if they want to.
   * Detaching just stops the source from appearing in the Re-sync UI.
   */
  async deleteSource(userId: string, sourceId: string): Promise<void> {
    const [source] = await this.db
      .select()
      .from(driveImportSources)
      .where(
        and(
          eq(driveImportSources.id, sourceId),
          eq(driveImportSources.ownerId, userId),
        ),
      );
    if (!source) throw new NotFoundException('Drive source not found');
    if (source.ownerId !== userId) throw new ForbiddenException();
    await this.db
      .delete(driveImportSources)
      .where(eq(driveImportSources.id, sourceId));
  }

  // ─────────────────────────────────────────────────────────────────
  // File-count estimate (powers the dialog warning banner)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Cheap one-page scan that tells the FE roughly how many files would
   * be imported before the user clicks "Import entire Drive". Applies
   * the extension allowlist so the count matches what the actual import
   * would pick up. `hasMore: true` means the Drive exceeds 1 000 files
   * and the FE should fall back to the generic "up to 10,000" message.
   */
  async getFileCountEstimate(
    userId: string,
  ): Promise<{ count: number; hasMore: boolean }> {
    this.logger.log(`[file-count] starting for user ${userId}`);
    try {
      const { fileNames, hasMore } = await this.drive.estimateFileCount(userId);
      this.logger.log(
        `[file-count] drive returned ${fileNames.length} names, hasMore=${hasMore}`,
      );
      const count = fileNames.filter((n) =>
        UPLOAD_ALLOWED_EXTENSIONS.test(n),
      ).length;
      this.logger.log(`[file-count] after ext filter: ${count}`);
      return { count, hasMore };
    } catch (err) {
      this.logger.error(
        `[file-count] failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Async (progress-tracked) Entire-Drive import
  // ─────────────────────────────────────────────────────────────────

  /**
   * Start a background "Entire Drive" import. Returns immediately with
   * `{ started: true }`. The actual scan + insert runs fire-and-forget;
   * poll `getImportProgress()` to track it. Only `scope.kind === 'all'`
   * is supported — folder-scoped imports are fast enough to be sync.
   */
  startImportAllAsync(
    userId: string,
    scope: ImportScope,
  ): Promise<{ started: true }> {
    if (scope.kind !== 'all') {
      throw new BadRequestException(
        'Async import is only supported for the "all" (Entire Drive) scope.',
      );
    }

    // Re-use the same visibility validation as importFromDrive.
    const VALID: DriveVisibility[] = ['all', 'admins', 'teams', 'project'];
    if (scope.visibility !== undefined && !VALID.includes(scope.visibility)) {
      throw new BadRequestException(
        `Invalid visibility "${scope.visibility}".`,
      );
    }
    if (
      scope.visibility === 'teams' &&
      (!Array.isArray(scope.teamIds) || scope.teamIds.length === 0)
    ) {
      throw new BadRequestException(
        'teamIds must be a non-empty array when visibility is "teams".',
      );
    }
    if (
      scope.visibility === 'project' &&
      (!Array.isArray(scope.projectIds) || scope.projectIds.length === 0)
    ) {
      throw new BadRequestException(
        'projectIds must be a non-empty array when visibility is "project".',
      );
    }

    // Reject a second concurrent import.
    const existing = this.activeJobs.get(userId);
    if (
      existing &&
      (existing.progress.phase === 'scanning' ||
        existing.progress.phase === 'importing')
    ) {
      throw new ConflictException(
        'A Drive import is already in progress. Cancel it first or wait for it to finish.',
      );
    }
    // Clean up any stale terminal job.
    this.activeJobs.delete(userId);

    const job: ActiveImportJob = {
      progress: { phase: 'scanning', scanned: 0, total: 0, imported: 0 },
      cancelled: false,
      insertedFileIds: [],
      createdSourceId: null,
    };
    this.activeJobs.set(userId, job);

    void this._runImportAllJob(userId, scope, job).catch((err) => {
      if (this.activeJobs.get(userId) === job) {
        job.progress.phase = 'error';
        job.progress.error =
          err instanceof Error ? err.message : 'Unknown error';
        this.logger.error(
          `Drive async import failed for user ${userId}: ${job.progress.error}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    });

    return Promise.resolve({ started: true } as const);
  }

  /**
   * Current progress for the user's active import. Returns null when
   * no job is tracked (either never started or already cleaned up).
   */
  getImportProgress(userId: string): DriveImportProgress | null {
    return this.activeJobs.get(userId)?.progress ?? null;
  }

  /**
   * Cancel the user's running import and roll back every file row
   * inserted so far. Silently no-ops if no import is active.
   */
  async cancelImport(userId: string): Promise<void> {
    const job = this.activeJobs.get(userId);
    if (!job) return;

    const isRunning =
      job.progress.phase === 'scanning' || job.progress.phase === 'importing';

    if (isRunning) {
      // Signal the loop to stop at its next checkpoint.
      job.cancelled = true;

      // Snapshot inserted IDs before the loop can append more.
      const idsToDelete = [...job.insertedFileIds];
      job.insertedFileIds = [];
      job.progress.phase = 'cancelled';

      // Delete in batches of 1000 to stay within DB query limits.
      const CHUNK = 1000;
      for (let i = 0; i < idsToDelete.length; i += CHUNK) {
        const chunk = idsToDelete.slice(i, i + CHUNK);
        await this.db
          .delete(knowledgeFiles)
          .where(
            and(
              eq(knowledgeFiles.uploadedById, userId),
              inArray(knowledgeFiles.id, chunk),
            ),
          );
      }

      // Remove the source row if this job created it (re-import starts fresh).
      if (job.createdSourceId) {
        await this.db
          .delete(driveImportSources)
          .where(eq(driveImportSources.id, job.createdSourceId));
        job.createdSourceId = null;
      }
    }

    this.activeJobs.delete(userId);
  }

  /**
   * Background worker started by startImportAllAsync. Any unhandled
   * throw is caught by the .catch() in startImportAllAsync, which sets
   * phase='error'. The `finally` block always schedules a GC timeout so
   * the job doesn't leak memory if the FE never polls after completion.
   */
  private async _runImportAllJob(
    userId: string,
    scope: ImportScope,
    job: ActiveImportJob,
  ): Promise<void> {
    try {
      const connection = await this.oauth.requireConnection(userId);
      const driveParentFolderId = await this.ensureDriveParentFolder(userId);

      const [uploader] = await this.db
        .select({ profileType: users.profileType })
        .from(users)
        .where(eq(users.id, userId));
      const fileScope =
        uploader?.profileType === 'company' ? 'company' : 'personal';
      const visibility = scope.visibility ?? 'all';

      // ── Phase 1: Scan ─────────────────────────────────────────────
      job.progress.phase = 'scanning';

      let files: import('../google-drive/google-drive-client.service.js').DriveFileMeta[];
      try {
        files = await this.drive.listFiles(
          userId,
          { kind: 'all' },
          MAX_ALL_IMPORT_FILES + 1,
          (count) => {
            job.progress.scanned = count;
            if (job.cancelled) throw new ImportCancelledError();
          },
        );
      } catch (err) {
        if (err instanceof ImportCancelledError) return; // cleanup done by cancelImport
        throw err;
      }

      if (job.cancelled) return;

      // Clamp rather than reject — partial imports are better than errors.
      const cappedFiles = files.slice(0, MAX_ALL_IMPORT_FILES);

      // ── Phase 2: Filter + dedupe ──────────────────────────────────
      const sizeFiltered = cappedFiles.filter(
        (f) => f.sizeBytes == null || f.sizeBytes <= MAX_DRIVE_FILE_BYTES,
      );
      const extFiltered = sizeFiltered.filter((f) =>
        UPLOAD_ALLOWED_EXTENSIONS.test(f.name),
      );

      const candidateIds = extFiltered.map((f) => f.id);
      const existingExternal = candidateIds.length
        ? await this.db
            .select({ externalId: knowledgeFiles.externalId })
            .from(knowledgeFiles)
            .where(
              and(
                eq(knowledgeFiles.uploadedById, userId),
                inArray(knowledgeFiles.externalId, candidateIds),
              ),
            )
        : [];
      const existingSet = new Set(
        existingExternal
          .map((r) => r.externalId)
          .filter((id): id is string => id !== null),
      );
      const newFiles = extFiltered.filter((f) => !existingSet.has(f.id));

      if (job.cancelled) return;

      job.progress.total = newFiles.length;
      job.progress.phase = 'importing';

      // Upsert source row before inserting files.
      const [existingSource] = await this.db
        .select({
          id: driveImportSources.id,
          fileCountAtLastSync: driveImportSources.fileCountAtLastSync,
        })
        .from(driveImportSources)
        .where(
          and(
            eq(driveImportSources.ownerId, userId),
            eq(driveImportSources.scope, 'all'),
          ),
        );

      let sourceId: string;
      if (existingSource) {
        sourceId = existingSource.id;
      } else {
        const [created] = await this.db
          .insert(driveImportSources)
          .values({
            ownerId: userId,
            connectionId: connection.id,
            scope: 'all',
            driveFolderId: null,
            driveFolderName: 'My Drive',
            fileCountAtLastSync: 0, // updated at the end
            visibility,
            teamIds: scope.teamIds ?? null,
            projectIds: scope.projectIds ?? null,
          })
          .returning({ id: driveImportSources.id });
        sourceId = created.id;
        job.createdSourceId = sourceId;
      }

      // ── Phase 3: Insert in batches of 100 ─────────────────────────
      const BATCH_SIZE = 100;
      let totalInserted = 0;

      for (let i = 0; i < newFiles.length; i += BATCH_SIZE) {
        if (job.cancelled) break;

        const batch = newFiles.slice(i, i + BATCH_SIZE);
        const insertedRows = await this.db
          .insert(knowledgeFiles)
          .values(
            batch.map((f) => ({
              folderId: driveParentFolderId,
              name: f.name,
              fileType: this.extFromName(f.name),
              sizeBytes: f.sizeBytes ?? 0,
              storagePath: null,
              uploadedById: userId,
              scope: fileScope,
              visibility,
              source: 'drive' as const,
              externalId: f.id,
              externalUrl: f.webViewLink ?? null,
            })),
          )
          .returning({ id: knowledgeFiles.id });

        for (const row of insertedRows) {
          job.insertedFileIds.push(row.id);
        }
        totalInserted += insertedRows.length;
        job.progress.imported = totalInserted;

        // Team / project junction rows.
        if (visibility === 'teams' && (scope.teamIds ?? []).length > 0) {
          await this.db.insert(knowledgeFileTeams).values(
            insertedRows.flatMap((row) =>
              (scope.teamIds ?? []).map((teamId) => ({
                fileId: row.id,
                teamId,
              })),
            ),
          );
        }
        if (visibility === 'project' && (scope.projectIds ?? []).length > 0) {
          await this.db.insert(projectKnowledgeFiles).values(
            insertedRows.flatMap((row) =>
              (scope.projectIds ?? []).map((projectId) => ({
                projectId,
                fileId: row.id,
                attachedBy: userId,
              })),
            ),
          );
        }
      }

      if (job.cancelled) return; // cleanup done by cancelImport

      // ── Finalise ──────────────────────────────────────────────────
      const prevCount = existingSource?.fileCountAtLastSync ?? 0;
      await this.db
        .update(driveImportSources)
        .set({
          lastSyncedAt: new Date(),
          fileCountAtLastSync: prevCount + totalInserted,
          driveFolderName: 'My Drive',
        })
        .where(eq(driveImportSources.id, sourceId));

      await this.db
        .update(knowledgeFolders)
        .set({ updatedAt: new Date() })
        .where(eq(knowledgeFolders.id, driveParentFolderId));

      await this.oauth.markSynced(userId);

      if (totalInserted > 0) {
        this.ingestion.ingestPendingFilesForUser(userId);
      }

      job.progress.phase = 'done';
    } finally {
      // Auto-clean terminal jobs after 5 min so memory doesn't accumulate.
      // The reference check ensures cancelImport() (which already deletes
      // the entry) doesn't accidentally resurrect a stale one.
      setTimeout(
        () => {
          if (this.activeJobs.get(userId) === job) {
            this.activeJobs.delete(userId);
          }
        },
        5 * 60 * 1000,
      );
    }
  }

  /**
   * Ensure the top-level "Google Drive" KC folder exists for this
   * user, return its id. Idempotent — picks up an existing folder by
   * name (parent_folder_id IS NULL) if the user previously imported.
   */
  private async ensureDriveParentFolder(userId: string): Promise<string> {
    const [existing] = await this.db
      .select({ id: knowledgeFolders.id })
      .from(knowledgeFolders)
      .where(
        and(
          eq(knowledgeFolders.ownerId, userId),
          eq(knowledgeFolders.name, DRIVE_PARENT_FOLDER_NAME),
          // Constrain to top-level — if the user happens to have a
          // child folder also named "Google Drive" somewhere, we
          // don't want to nest under it accidentally.
          sql`${knowledgeFolders.parentFolderId} IS NULL`,
        ),
      );
    if (existing) return existing.id;
    const [created] = await this.db
      .insert(knowledgeFolders)
      .values({
        name: DRIVE_PARENT_FOLDER_NAME,
        ownerId: userId,
        parentFolderId: null,
      })
      .returning({ id: knowledgeFolders.id });
    return created.id;
  }

  /**
   * Ensure a child folder named `name` exists under `parentId` for
   * this user, return its id. Used to nest per-Drive-folder children
   * under the "Google Drive" parent so multiple Drive sources don't
   * pile into one mixed bag. Re-imports of the same Drive folder
   * land in the same KC child.
   *
   * Match is by (owner, parent, name) so a user could theoretically
   * have a manual KC subfolder with the same name under a DIFFERENT
   * parent without colliding here.
   */
  private async ensureChildFolder(
    userId: string,
    parentId: string,
    name: string,
  ): Promise<string> {
    const [existing] = await this.db
      .select({ id: knowledgeFolders.id })
      .from(knowledgeFolders)
      .where(
        and(
          eq(knowledgeFolders.ownerId, userId),
          eq(knowledgeFolders.parentFolderId, parentId),
          eq(knowledgeFolders.name, name),
        ),
      );
    if (existing) return existing.id;
    const [created] = await this.db
      .insert(knowledgeFolders)
      .values({
        name,
        ownerId: userId,
        parentFolderId: parentId,
      })
      .returning({ id: knowledgeFolders.id });
    return created.id;
  }

  /**
   * Resolve a Drive folder's display name via a direct `files.get`
   * call. Works for any folder depth — not just root-level children —
   * and falls back to a synthetic slug on error (permission denied,
   * folder deleted, etc.). The name is a display cache for the
   * Re-sync UI; losing it doesn't break sync.
   */
  private resolveDriveFolderName(
    userId: string,
    folderId: string,
  ): Promise<string> {
    return this.drive.getFolderName(userId, folderId);
  }

  /**
   * Refuse the import if the total file count would blow past the
   * per-import cap. Hard error (BadRequestException → FE toast) is
   * deliberately picked over silent truncation: a user who imported
   * "Entire Drive" and got only the first N files would assume
   * everything went through, miss the rest, and trip over it later.
   */
  private enforceImportCountCap(
    totalFiles: number,
    kind: 'all' | 'folders',
  ): void {
    const cap = kind === 'all' ? MAX_ALL_IMPORT_FILES : MAX_FOLDER_IMPORT_FILES;
    if (totalFiles > cap) {
      throw new BadRequestException(
        kind === 'all'
          ? `Your Drive has more than ${cap.toLocaleString()} supported files — the cap for an Entire Drive import is ${cap.toLocaleString()}. Contact support to raise the limit.`
          : `This folder selection contains ${totalFiles} files — the cap is ${MAX_FOLDER_IMPORT_FILES.toLocaleString()} per import. Pick fewer folders or contact support to raise the limit.`,
      );
    }
  }

  /**
   * Insert new knowledge_files rows + upsert the source record.
   * Dedupe by (uploaded_by_id, external_id) against existing rows —
   * Re-sync of the same source only adds files that appeared since last
   * sync. Filters out oversized files (skippedTooLarge) and files with
   * unsupported extensions (skippedUnsupported) before any DB writes.
   * Touches the KC folder's updatedAt so the folder surfaces at the
   * top of recently-modified lists.
   */
  private async upsertFilesAndSource(
    userId: string,
    args: {
      files: DriveFileMeta[];
      sourceScope: 'all' | 'folder';
      driveFolderId: string | null;
      driveFolderName: string;
      connectionId: string;
      kcFolderId: string;
      kcFileScope: string;
      visibility?: DriveVisibility;
      teamIds?: string[];
      projectIds?: string[];
    },
  ): Promise<{
    sourceId: string;
    added: number;
    skippedDuplicates: number;
    skippedTooLarge: number;
    skippedUnsupported: number;
  }> {
    // Strip files Drive reports as larger than MAX_DRIVE_FILE_BYTES
    // BEFORE we insert any KC row — saves a download round-trip + a
    // failed-ingestion row per oversized binary. Native Google
    // formats slip through here (size is null until export) and get
    // a post-download check in KnowledgeIngestionService.fetchDriveBytes.
    const sizeFilteredFiles: DriveFileMeta[] = [];
    let skippedTooLarge = 0;
    for (const f of args.files) {
      if (f.sizeBytes != null && f.sizeBytes > MAX_DRIVE_FILE_BYTES) {
        skippedTooLarge++;
        continue;
      }
      sizeFilteredFiles.push(f);
    }

    // Strip files whose extension KC can't parse (same allowlist as
    // the manual upload endpoint). Google-native exports always produce
    // .docx/.xlsx/.pdf so they all pass; the only files filtered here
    // are uploaded binaries with unsupported formats (videos, images,
    // zip archives, etc.). Counting them and returning to the FE is
    // cleaner than creating a row that immediately lands in
    // ingestion_error='Skipped'.
    const ingestionReadyFiles: DriveFileMeta[] = [];
    let skippedUnsupported = 0;
    for (const f of sizeFilteredFiles) {
      if (!UPLOAD_ALLOWED_EXTENSIONS.test(f.name)) {
        skippedUnsupported++;
        continue;
      }
      ingestionReadyFiles.push(f);
    }

    // De-dupe against existing rows. One probe with inArray over the
    // candidate set is O(N) Postgres-side and avoids N+1 queries.
    const candidateIds = ingestionReadyFiles.map((f) => f.id);
    const existingExternal = candidateIds.length
      ? await this.db
          .select({ externalId: knowledgeFiles.externalId })
          .from(knowledgeFiles)
          .where(
            and(
              eq(knowledgeFiles.uploadedById, userId),
              inArray(knowledgeFiles.externalId, candidateIds),
            ),
          )
      : [];
    const existingSet = new Set(
      existingExternal
        .map((r) => r.externalId)
        .filter((id): id is string => id !== null),
    );

    const newFiles = ingestionReadyFiles.filter((f) => !existingSet.has(f.id));

    // ON CONFLICT DO UPDATE for the source row so a second import of
    // the same folder folds in as a Re-sync. The partial unique index
    // makes (ownerId, driveFolderId) the conflict target for
    // scope='folder', and (ownerId) WHERE scope='all' for scope='all'
    // — we can't use one INSERT…ON CONFLICT for both, so dispatch.
    let sourceId: string;
    const [existingSource] = await this.db
      .select({
        id: driveImportSources.id,
        // Fetch the stored count so we can increment rather than
        // recompute — countSourceFiles() returned 0 for folder-scoped
        // sources, which reset the chip to only the new batch size.
        fileCountAtLastSync: driveImportSources.fileCountAtLastSync,
      })
      .from(driveImportSources)
      .where(
        and(
          eq(driveImportSources.ownerId, userId),
          args.sourceScope === 'all'
            ? eq(driveImportSources.scope, 'all')
            : eq(driveImportSources.driveFolderId, args.driveFolderId ?? ''),
        ),
      );
    if (existingSource) {
      const updatedCount = existingSource.fileCountAtLastSync + newFiles.length;
      // Preserve the original visibility on re-sync — callers that
      // don't pass visibility (re-sync path) must read it from the
      // source row first and forward it, so we never overwrite it here.
      await this.db
        .update(driveImportSources)
        .set({
          lastSyncedAt: new Date(),
          fileCountAtLastSync: updatedCount,
          driveFolderName: args.driveFolderName,
        })
        .where(eq(driveImportSources.id, existingSource.id));
      sourceId = existingSource.id;
    } else {
      const [inserted] = await this.db
        .insert(driveImportSources)
        .values({
          ownerId: userId,
          connectionId: args.connectionId,
          scope: args.sourceScope,
          driveFolderId: args.driveFolderId,
          driveFolderName: args.driveFolderName,
          fileCountAtLastSync: newFiles.length,
          // Persist visibility so Re-sync can reproduce the original
          // selection without asking the user again.
          visibility: args.visibility ?? 'all',
          teamIds: args.teamIds ?? null,
          projectIds: args.projectIds ?? null,
        })
        .returning({ id: driveImportSources.id });
      sourceId = inserted.id;
    }

    if (newFiles.length === 0) {
      return {
        sourceId,
        added: 0,
        skippedDuplicates: existingSet.size,
        skippedTooLarge,
        skippedUnsupported,
      };
    }

    // Insert knowledge_files rows in a single batched insert. fileType
    // mirrors Drive's MIME (after Google-native export) — the
    // ingestion path reads `name`'s extension for parser dispatch, so
    // fileType is purely for display in the KC UI right now.
    const insertedFiles = await this.db
      .insert(knowledgeFiles)
      .values(
        newFiles.map((f) => ({
          folderId: args.kcFolderId,
          name: f.name,
          fileType: this.extFromName(f.name),
          sizeBytes: f.sizeBytes ?? 0,
          // storagePath stays NULL until the ingestion worker downloads
          // the bytes from Drive. Marks the row as "needs download" in
          // the ingestion branch.
          storagePath: null,
          uploadedById: userId,
          scope: args.kcFileScope,
          visibility: args.visibility ?? 'all',
          source: 'drive' as const,
          externalId: f.id,
          externalUrl: f.webViewLink ?? null,
        })),
      )
      .returning({ id: knowledgeFiles.id });

    // Link inserted files to teams / projects via junction tables,
    // mirroring the same pattern used by the manual upload path.
    const visibility = args.visibility ?? 'all';
    if (visibility === 'teams' && (args.teamIds ?? []).length > 0) {
      await this.db
        .insert(knowledgeFileTeams)
        .values(
          insertedFiles.flatMap((row) =>
            (args.teamIds ?? []).map((teamId) => ({ fileId: row.id, teamId })),
          ),
        );
    }
    if (visibility === 'project' && (args.projectIds ?? []).length > 0) {
      await this.db.insert(projectKnowledgeFiles).values(
        insertedFiles.flatMap((row) =>
          (args.projectIds ?? []).map((projectId) => ({
            projectId,
            fileId: row.id,
            attachedBy: userId,
          })),
        ),
      );
    }

    // Touch the KC folder's updatedAt so folder-list queries that order
    // by recency surface this folder at the top after an import.
    await this.db
      .update(knowledgeFolders)
      .set({ updatedAt: new Date() })
      .where(eq(knowledgeFolders.id, args.kcFolderId));

    return {
      sourceId,
      added: newFiles.length,
      skippedDuplicates: existingSet.size,
      skippedTooLarge,
      skippedUnsupported,
    };
  }

  private extFromName(name: string): string {
    const dot = name.lastIndexOf('.');
    if (dot === -1 || dot === name.length - 1) return 'FILE';
    return name.slice(dot + 1).toUpperCase();
  }
}
