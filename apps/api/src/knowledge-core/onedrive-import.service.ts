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
  knowledgeFileTeams,
  knowledgeFiles,
  knowledgeFolders,
  onedriveImportSources,
  projectKnowledgeFiles,
  scheduleKnowledgeFiles,
  users,
} from '@worken/database/schema';
import { UPLOAD_ALLOWED_EXTENSIONS } from './upload-allowlist.js';

import { DATABASE, type Database } from '../database/database.module.js';
import { MicrosoftOAuthService } from '../microsoft/microsoft-oauth.service.js';
import {
  OneDriveGraphService,
  type OneDriveFileMeta,
} from '../onedrive/onedrive-graph.service.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';

/**
 * The KC parent folder OneDrive imports nest under. Direct mirror of
 * the Drive integration's "Google Drive" parent — Entire-OneDrive
 * imports land here, folder-scoped imports each get their own child
 * folder named exactly after the OneDrive source.
 */
const ONEDRIVE_PARENT_FOLDER_NAME = 'OneDrive';

const MAX_FOLDER_IMPORT_FILES = 1000;
const MAX_ALL_IMPORT_FILES = 10_000;
const MAX_ONEDRIVE_FILE_BYTES = 50 * 1024 * 1024;

export type OneDriveVisibility =
  | 'all'
  | 'admins'
  | 'none'
  | 'teams'
  | 'project'
  | 'schedule';

export type OneDriveImportScope = (
  | { kind: 'all' }
  | { kind: 'folders'; folderIds: string[] }
) & {
  visibility?: OneDriveVisibility;
  teamIds?: string[];
  projectIds?: string[];
  scheduleIds?: string[];
};

export interface OneDriveImportResult {
  added: number;
  skippedDuplicates: number;
  skippedUnsupported: number;
  skippedTooLarge: number;
  sources: { id: string; onedriveFolderName: string }[];
}

export interface OneDriveSourceRow {
  id: string;
  scope: 'all' | 'folder';
  onedriveFolderId: string | null;
  onedriveFolderName: string;
  lastSyncedAt: string;
  fileCountAtLastSync: number;
  createdAt: string;
}

export interface OneDriveImportProgress {
  phase: 'scanning' | 'importing' | 'done' | 'cancelled' | 'error';
  scanned: number;
  total: number;
  imported: number;
  error?: string;
}

interface ActiveImportJob {
  progress: OneDriveImportProgress;
  cancelled: boolean;
  insertedFileIds: string[];
  createdSourceId: string | null;
}

class ImportCancelledError extends Error {
  constructor() {
    super('OneDrive import cancelled by user');
  }
}

@Injectable()
export class OneDriveImportService {
  private readonly logger = new Logger(OneDriveImportService.name);

  private readonly activeJobs = new Map<string, ActiveImportJob>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly oauth: MicrosoftOAuthService,
    private readonly drive: OneDriveGraphService,
    private readonly ingestion: KnowledgeIngestionService,
  ) {}

  /**
   * Import (or Re-sync if the same scope was imported before) files
   * from the user's OneDrive into KC. Files we already have (matched
   * by `(uploaded_by_id, external_id)`) are skipped — Re-sync is just
   * "add new files since last time".
   */
  async importFromOneDrive(
    userId: string,
    scope: OneDriveImportScope,
  ): Promise<OneDriveImportResult> {
    if (
      scope.kind === 'folders' &&
      (!Array.isArray(scope.folderIds) || scope.folderIds.length === 0)
    ) {
      throw new BadRequestException(
        'folderIds must be a non-empty array when scope is "folders".',
      );
    }

    const VALID_VISIBILITIES: OneDriveVisibility[] = [
      'all',
      'admins',
      'none',
      'teams',
      'project',
      'schedule',
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
    if (
      scope.visibility === 'schedule' &&
      (!Array.isArray(scope.scheduleIds) || scope.scheduleIds.length === 0)
    ) {
      throw new BadRequestException(
        'scheduleIds must be a non-empty array when visibility is "schedule".',
      );
    }

    const connection = await this.oauth.requireConnection(userId);
    const onedriveParentFolderId =
      await this.ensureOneDriveParentFolder(userId);

    const [uploader] = await this.db
      .select({ profileType: users.profileType })
      .from(users)
      .where(eq(users.id, userId));
    const fileScope =
      uploader?.profileType === 'company' ? 'company' : 'personal';

    const result: OneDriveImportResult = {
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
      const inserted = await this.upsertFilesAndSource(userId, {
        files,
        sourceScope: 'all',
        onedriveFolderId: null,
        onedriveFolderName: 'My OneDrive',
        connectionId: connection.id,
        kcFolderId: onedriveParentFolderId,
        kcFileScope: fileScope,
        visibility: scope.visibility,
        teamIds: scope.teamIds,
        projectIds: scope.projectIds,
        scheduleIds: scope.scheduleIds,
      });
      result.added += inserted.added;
      result.skippedDuplicates += inserted.skippedDuplicates;
      result.skippedTooLarge += inserted.skippedTooLarge;
      result.skippedUnsupported += inserted.skippedUnsupported;
      result.sources.push({
        id: inserted.sourceId,
        onedriveFolderName: 'My OneDrive',
      });
    } else {
      const perFolder: {
        folderId: string;
        folderName: string;
        files: OneDriveFileMeta[];
      }[] = [];
      let totalFiles = 0;
      for (const folderId of scope.folderIds) {
        const folderName = await this.resolveOneDriveFolderName(
          userId,
          folderId,
        );
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
        const kcChildFolderId = await this.ensureChildFolder(
          userId,
          onedriveParentFolderId,
          entry.folderName,
        );
        const inserted = await this.upsertFilesAndSource(userId, {
          files: entry.files,
          sourceScope: 'folder',
          onedriveFolderId: entry.folderId,
          onedriveFolderName: entry.folderName,
          connectionId: connection.id,
          kcFolderId: kcChildFolderId,
          kcFileScope: fileScope,
          visibility: scope.visibility,
          teamIds: scope.teamIds,
          projectIds: scope.projectIds,
          scheduleIds: scope.scheduleIds,
        });
        result.added += inserted.added;
        result.skippedDuplicates += inserted.skippedDuplicates;
        result.skippedTooLarge += inserted.skippedTooLarge;
        result.skippedUnsupported += inserted.skippedUnsupported;
        result.sources.push({
          id: inserted.sourceId,
          onedriveFolderName: entry.folderName,
        });
      }
    }

    await this.oauth.markSynced(userId);

    if (result.added > 0) {
      this.ingestion.ingestPendingFilesForUser(userId, { fromImport: true });
    }

    return result;
  }

  async resyncSource(
    userId: string,
    sourceId: string,
  ): Promise<OneDriveImportResult> {
    const [source] = await this.db
      .select()
      .from(onedriveImportSources)
      .where(
        and(
          eq(onedriveImportSources.id, sourceId),
          eq(onedriveImportSources.ownerId, userId),
        ),
      );
    if (!source) throw new NotFoundException('OneDrive source not found');

    const visibilityExtras = {
      visibility: (source.visibility as OneDriveVisibility) ?? undefined,
      teamIds: source.teamIds ?? undefined,
      projectIds: source.projectIds ?? undefined,
      scheduleIds: source.scheduleIds ?? undefined,
    };

    if (source.scope === 'all') {
      return this.importFromOneDrive(userId, {
        kind: 'all',
        ...visibilityExtras,
      });
    }
    if (!source.onedriveFolderId) {
      throw new BadRequestException(
        'Folder-scoped source is missing its OneDrive folder id; remove and re-import.',
      );
    }
    return this.importFromOneDrive(userId, {
      kind: 'folders',
      folderIds: [source.onedriveFolderId],
      ...visibilityExtras,
    });
  }

  async listSources(userId: string): Promise<OneDriveSourceRow[]> {
    const rows = await this.db
      .select()
      .from(onedriveImportSources)
      .where(eq(onedriveImportSources.ownerId, userId))
      .orderBy(sql`${onedriveImportSources.lastSyncedAt} DESC`);
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope as 'all' | 'folder',
      onedriveFolderId: r.onedriveFolderId,
      onedriveFolderName: r.onedriveFolderName,
      lastSyncedAt: r.lastSyncedAt.toISOString(),
      fileCountAtLastSync: r.fileCountAtLastSync,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async deleteSource(userId: string, sourceId: string): Promise<void> {
    const [source] = await this.db
      .select()
      .from(onedriveImportSources)
      .where(
        and(
          eq(onedriveImportSources.id, sourceId),
          eq(onedriveImportSources.ownerId, userId),
        ),
      );
    if (!source) throw new NotFoundException('OneDrive source not found');
    if (source.ownerId !== userId) throw new ForbiddenException();
    await this.db
      .delete(onedriveImportSources)
      .where(eq(onedriveImportSources.id, sourceId));
  }

  // ─────────────────────────────────────────────────────────────────
  // File-count estimate (powers the dialog warning banner)
  // ─────────────────────────────────────────────────────────────────

  async getFileCountEstimate(
    userId: string,
  ): Promise<{ count: number; hasMore: boolean }> {
    this.logger.log(`[onedrive file-count] starting for user ${userId}`);
    try {
      const { fileNames, hasMore } = await this.drive.estimateFileCount(userId);
      const count = fileNames.filter((n) =>
        UPLOAD_ALLOWED_EXTENSIONS.test(n),
      ).length;
      this.logger.log(
        `[onedrive file-count] after ext filter: ${count}, hasMore=${hasMore}`,
      );
      return { count, hasMore };
    } catch (err) {
      this.logger.error(
        `[onedrive file-count] failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Async (progress-tracked) Entire-OneDrive import
  // ─────────────────────────────────────────────────────────────────

  startImportAllAsync(
    userId: string,
    scope: OneDriveImportScope,
  ): Promise<{ started: true }> {
    if (scope.kind !== 'all') {
      throw new BadRequestException(
        'Async import is only supported for the "all" (Entire OneDrive) scope.',
      );
    }

    const VALID: OneDriveVisibility[] = [
      'all',
      'admins',
      'none',
      'teams',
      'project',
      'schedule',
    ];
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
    if (
      scope.visibility === 'schedule' &&
      (!Array.isArray(scope.scheduleIds) || scope.scheduleIds.length === 0)
    ) {
      throw new BadRequestException(
        'scheduleIds must be a non-empty array when visibility is "schedule".',
      );
    }

    const existing = this.activeJobs.get(userId);
    if (
      existing &&
      (existing.progress.phase === 'scanning' ||
        existing.progress.phase === 'importing')
    ) {
      throw new ConflictException(
        'A OneDrive import is already in progress. Cancel it first or wait for it to finish.',
      );
    }
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
          `OneDrive async import failed for user ${userId}: ${job.progress.error}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    });

    return Promise.resolve({ started: true } as const);
  }

  getImportProgress(userId: string): OneDriveImportProgress | null {
    return this.activeJobs.get(userId)?.progress ?? null;
  }

  async cancelImport(userId: string): Promise<void> {
    const job = this.activeJobs.get(userId);
    if (!job) return;

    const isRunning =
      job.progress.phase === 'scanning' || job.progress.phase === 'importing';

    if (isRunning) {
      job.cancelled = true;
      const idsToDelete = [...job.insertedFileIds];
      job.insertedFileIds = [];
      job.progress.phase = 'cancelled';

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

      if (job.createdSourceId) {
        await this.db
          .delete(onedriveImportSources)
          .where(eq(onedriveImportSources.id, job.createdSourceId));
        job.createdSourceId = null;
      }
    }

    this.activeJobs.delete(userId);
  }

  private async _runImportAllJob(
    userId: string,
    scope: OneDriveImportScope,
    job: ActiveImportJob,
  ): Promise<void> {
    try {
      const connection = await this.oauth.requireConnection(userId);
      const onedriveParentFolderId =
        await this.ensureOneDriveParentFolder(userId);

      const [uploader] = await this.db
        .select({ profileType: users.profileType })
        .from(users)
        .where(eq(users.id, userId));
      const fileScope =
        uploader?.profileType === 'company' ? 'company' : 'personal';
      const visibility = scope.visibility ?? 'all';

      // ── Phase 1: Scan ─────────────────────────────────────────────
      job.progress.phase = 'scanning';

      let files: OneDriveFileMeta[];
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
        if (err instanceof ImportCancelledError) return;
        throw err;
      }

      if (job.cancelled) return;

      const cappedFiles = files.slice(0, MAX_ALL_IMPORT_FILES);

      // ── Phase 2: Filter + dedupe ──────────────────────────────────
      const sizeFiltered = cappedFiles.filter(
        (f) => f.sizeBytes == null || f.sizeBytes <= MAX_ONEDRIVE_FILE_BYTES,
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

      const [existingSource] = await this.db
        .select({
          id: onedriveImportSources.id,
          fileCountAtLastSync: onedriveImportSources.fileCountAtLastSync,
        })
        .from(onedriveImportSources)
        .where(
          and(
            eq(onedriveImportSources.ownerId, userId),
            eq(onedriveImportSources.scope, 'all'),
          ),
        );

      let sourceId: string;
      if (existingSource) {
        sourceId = existingSource.id;
      } else {
        const [created] = await this.db
          .insert(onedriveImportSources)
          .values({
            ownerId: userId,
            connectionId: connection.id,
            scope: 'all',
            onedriveFolderId: null,
            onedriveFolderName: 'My OneDrive',
            fileCountAtLastSync: 0,
            visibility,
            teamIds: scope.teamIds ?? null,
            projectIds: scope.projectIds ?? null,
            scheduleIds: scope.scheduleIds ?? null,
          })
          .returning({ id: onedriveImportSources.id });
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
              folderId: onedriveParentFolderId,
              name: f.name,
              fileType: this.extFromName(f.name),
              sizeBytes: f.sizeBytes ?? 0,
              storagePath: null,
              uploadedById: userId,
              scope: fileScope,
              visibility,
              source: 'onedrive' as const,
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

        if ((scope.teamIds ?? []).length > 0) {
          await this.db.insert(knowledgeFileTeams).values(
            insertedRows.flatMap((row) =>
              (scope.teamIds ?? []).map((teamId) => ({
                fileId: row.id,
                teamId,
              })),
            ),
          );
        }
        if ((scope.projectIds ?? []).length > 0) {
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
        if ((scope.scheduleIds ?? []).length > 0) {
          await this.db.insert(scheduleKnowledgeFiles).values(
            insertedRows.flatMap((row) =>
              (scope.scheduleIds ?? []).map((scheduledPromptId) => ({
                scheduledPromptId,
                fileId: row.id,
                attachedBy: userId,
              })),
            ),
          );
        }
      }

      if (job.cancelled) return;

      const prevCount = existingSource?.fileCountAtLastSync ?? 0;
      await this.db
        .update(onedriveImportSources)
        .set({
          lastSyncedAt: new Date(),
          fileCountAtLastSync: prevCount + totalInserted,
          onedriveFolderName: 'My OneDrive',
        })
        .where(eq(onedriveImportSources.id, sourceId));

      await this.db
        .update(knowledgeFolders)
        .set({ updatedAt: new Date() })
        .where(eq(knowledgeFolders.id, onedriveParentFolderId));

      await this.oauth.markSynced(userId);

      if (totalInserted > 0) {
        this.ingestion.ingestPendingFilesForUser(userId, { fromImport: true });
      }

      job.progress.phase = 'done';
    } finally {
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

  // ─────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────

  private async ensureOneDriveParentFolder(userId: string): Promise<string> {
    const [existing] = await this.db
      .select({ id: knowledgeFolders.id })
      .from(knowledgeFolders)
      .where(
        and(
          eq(knowledgeFolders.ownerId, userId),
          eq(knowledgeFolders.name, ONEDRIVE_PARENT_FOLDER_NAME),
          sql`${knowledgeFolders.parentFolderId} IS NULL`,
        ),
      );
    if (existing) return existing.id;
    const [created] = await this.db
      .insert(knowledgeFolders)
      .values({
        name: ONEDRIVE_PARENT_FOLDER_NAME,
        ownerId: userId,
        parentFolderId: null,
      })
      .returning({ id: knowledgeFolders.id });
    return created.id;
  }

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

  private resolveOneDriveFolderName(
    userId: string,
    folderId: string,
  ): Promise<string> {
    return this.drive.getFolderName(userId, folderId);
  }

  private enforceImportCountCap(
    totalFiles: number,
    kind: 'all' | 'folders',
  ): void {
    const cap = kind === 'all' ? MAX_ALL_IMPORT_FILES : MAX_FOLDER_IMPORT_FILES;
    if (totalFiles > cap) {
      throw new BadRequestException(
        kind === 'all'
          ? `Your OneDrive has more than ${cap.toLocaleString()} supported files — the cap for an Entire OneDrive import is ${cap.toLocaleString()}. Contact support to raise the limit.`
          : `This folder selection contains ${totalFiles} files — the cap is ${MAX_FOLDER_IMPORT_FILES.toLocaleString()} per import. Pick fewer folders or contact support to raise the limit.`,
      );
    }
  }

  private async upsertFilesAndSource(
    userId: string,
    args: {
      files: OneDriveFileMeta[];
      sourceScope: 'all' | 'folder';
      onedriveFolderId: string | null;
      onedriveFolderName: string;
      connectionId: string;
      kcFolderId: string;
      kcFileScope: string;
      visibility?: OneDriveVisibility;
      teamIds?: string[];
      projectIds?: string[];
      scheduleIds?: string[];
    },
  ): Promise<{
    sourceId: string;
    added: number;
    skippedDuplicates: number;
    skippedTooLarge: number;
    skippedUnsupported: number;
  }> {
    const sizeFilteredFiles: OneDriveFileMeta[] = [];
    let skippedTooLarge = 0;
    for (const f of args.files) {
      if (f.sizeBytes != null && f.sizeBytes > MAX_ONEDRIVE_FILE_BYTES) {
        skippedTooLarge++;
        continue;
      }
      sizeFilteredFiles.push(f);
    }

    const ingestionReadyFiles: OneDriveFileMeta[] = [];
    let skippedUnsupported = 0;
    for (const f of sizeFilteredFiles) {
      if (!UPLOAD_ALLOWED_EXTENSIONS.test(f.name)) {
        skippedUnsupported++;
        continue;
      }
      ingestionReadyFiles.push(f);
    }

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

    let sourceId: string;
    const [existingSource] = await this.db
      .select({
        id: onedriveImportSources.id,
        fileCountAtLastSync: onedriveImportSources.fileCountAtLastSync,
      })
      .from(onedriveImportSources)
      .where(
        and(
          eq(onedriveImportSources.ownerId, userId),
          args.sourceScope === 'all'
            ? eq(onedriveImportSources.scope, 'all')
            : eq(
                onedriveImportSources.onedriveFolderId,
                args.onedriveFolderId ?? '',
              ),
        ),
      );
    if (existingSource) {
      const updatedCount = existingSource.fileCountAtLastSync + newFiles.length;
      await this.db
        .update(onedriveImportSources)
        .set({
          lastSyncedAt: new Date(),
          fileCountAtLastSync: updatedCount,
          onedriveFolderName: args.onedriveFolderName,
        })
        .where(eq(onedriveImportSources.id, existingSource.id));
      sourceId = existingSource.id;
    } else {
      const [inserted] = await this.db
        .insert(onedriveImportSources)
        .values({
          ownerId: userId,
          connectionId: args.connectionId,
          scope: args.sourceScope,
          onedriveFolderId: args.onedriveFolderId,
          onedriveFolderName: args.onedriveFolderName,
          fileCountAtLastSync: newFiles.length,
          visibility: args.visibility ?? 'all',
          teamIds: args.teamIds ?? null,
          projectIds: args.projectIds ?? null,
          scheduleIds: args.scheduleIds ?? null,
        })
        .returning({ id: onedriveImportSources.id });
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

    const insertedFiles = await this.db
      .insert(knowledgeFiles)
      .values(
        newFiles.map((f) => ({
          folderId: args.kcFolderId,
          name: f.name,
          fileType: this.extFromName(f.name),
          sizeBytes: f.sizeBytes ?? 0,
          storagePath: null,
          uploadedById: userId,
          scope: args.kcFileScope,
          visibility: args.visibility ?? 'all',
          source: 'onedrive' as const,
          externalId: f.id,
          externalUrl: f.webViewLink ?? null,
        })),
      )
      .returning({ id: knowledgeFiles.id });

    if ((args.teamIds ?? []).length > 0) {
      await this.db
        .insert(knowledgeFileTeams)
        .values(
          insertedFiles.flatMap((row) =>
            (args.teamIds ?? []).map((teamId) => ({ fileId: row.id, teamId })),
          ),
        );
    }
    if ((args.projectIds ?? []).length > 0) {
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
    if ((args.scheduleIds ?? []).length > 0) {
      await this.db.insert(scheduleKnowledgeFiles).values(
        insertedFiles.flatMap((row) =>
          (args.scheduleIds ?? []).map((scheduledPromptId) => ({
            scheduledPromptId,
            fileId: row.id,
            attachedBy: userId,
          })),
        ),
      );
    }

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
