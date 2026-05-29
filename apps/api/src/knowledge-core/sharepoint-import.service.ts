import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import {
  sharepointImportSources,
  knowledgeFileTeams,
  knowledgeFiles,
  knowledgeFolders,
  projectKnowledgeFiles,
  users,
} from '@worken/database/schema';
import { UPLOAD_ALLOWED_EXTENSIONS } from './upload-allowlist.js';
import {
  validateSharePointScope,
  type SharePointImportScope as SharePointImportScopeBase,
  type SharePointVisibility as SharePointVisibilityBase,
} from './sharepoint-scope.js';

import { DATABASE, type Database } from '../database/database.module.js';
import {
  SharePointGraphService,
  type SharePointFileMeta,
} from '../sharepoint/sharepoint-graph.service.js';
import { SharePointOAuthService } from '../sharepoint/sharepoint-oauth.service.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';

/**
 * The KC parent folder SharePoint imports nest under. Site imports
 * create one child folder per site (named after the site). Folder
 * imports create one child folder per imported folder (named after
 * the SharePoint folder).
 */
const SP_PARENT_FOLDER_NAME = 'SharePoint';

const MAX_FOLDER_IMPORT_FILES = 1000;
const MAX_SITE_IMPORT_FILES = 10_000;

/** Match Drive's ceiling — 50 MB. */
const MAX_SP_FILE_BYTES = 50 * 1024 * 1024;

// Re-exported so existing callers (knowledge-core.controller.ts +
// FE-facing types) keep their import paths. The authoritative
// definitions live in sharepoint-scope.ts so they can be unit-tested
// in isolation from the service's DI graph.
export type SharePointVisibility = SharePointVisibilityBase;
export type SharePointImportScope = SharePointImportScopeBase;

export interface SharePointImportResult {
  added: number;
  skippedDuplicates: number;
  skippedUnsupported: number;
  skippedTooLarge: number;
  sources: { id: string; displayName: string }[];
}

export interface SharePointSourceRow {
  id: string;
  scope: 'site' | 'folder';
  siteId: string;
  siteName: string;
  driveId: string | null;
  driveName: string | null;
  folderId: string | null;
  folderName: string | null;
  /** Display name for the FE chip — site name for site scope, folder name otherwise. */
  displayName: string;
  lastSyncedAt: string;
  fileCountAtLastSync: number;
  createdAt: string;
}

export interface SharePointImportProgress {
  phase: 'scanning' | 'importing' | 'done' | 'cancelled' | 'error';
  scanned: number;
  total: number;
  imported: number;
  error?: string;
}

interface ActiveImportJob {
  progress: SharePointImportProgress;
  cancelled: boolean;
  insertedFileIds: string[];
  createdSourceId: string | null;
}

class ImportCancelledError extends Error {
  constructor() {
    super('SharePoint import cancelled by user');
  }
}

@Injectable()
export class SharePointImportService {
  private readonly logger = new Logger(SharePointImportService.name);

  /** One entry per user with a background import in progress. */
  private readonly activeJobs = new Map<string, ActiveImportJob>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly oauth: SharePointOAuthService,
    private readonly graph: SharePointGraphService,
    private readonly ingestion: KnowledgeIngestionService,
  ) {}

  /**
   * Import (or Re-sync) files from a SharePoint site / folder into KC.
   * Files we already have (matched by `(uploaded_by_id, external_id)`)
   * are skipped — Re-sync is just "add new files since last time".
   *
   * Whole-site scope (`kind: 'site'`) goes through the async path
   * (`startImportSiteAsync`) — this method handles it as a synchronous
   * fallback only because programmatic callers might want both shapes.
   * The FE only invokes the sync path for `kind: 'folder'`.
   */
  async importFromSharePoint(
    userId: string,
    scope: SharePointImportScope,
  ): Promise<SharePointImportResult> {
    validateSharePointScope(scope);
    const connection = await this.oauth.requireConnection(userId);
    const parentFolderId = await this.ensureSharePointParentFolder(userId);

    const [uploader] = await this.db
      .select({ profileType: users.profileType })
      .from(users)
      .where(eq(users.id, userId));
    const fileScope =
      uploader?.profileType === 'company' ? 'company' : 'personal';

    const result: SharePointImportResult = {
      added: 0,
      skippedDuplicates: 0,
      skippedUnsupported: 0,
      skippedTooLarge: 0,
      sources: [],
    };

    if (scope.kind === 'site') {
      const siteName = await this.graph.getSiteName(userId, scope.siteId);
      const files = await this.graph.listFiles(
        userId,
        { kind: 'site', siteId: scope.siteId },
        MAX_SITE_IMPORT_FILES + 1,
      );
      this.enforceImportCountCap(files.length, 'site');
      const kcChildFolderId = await this.ensureChildFolder(
        userId,
        parentFolderId,
        siteName,
      );
      const inserted = await this.upsertFilesAndSource(userId, {
        files,
        sourceScope: 'site',
        siteId: scope.siteId,
        siteName,
        driveId: null,
        driveName: null,
        folderId: null,
        folderName: null,
        displayName: siteName,
        connectionId: connection.id,
        kcFolderId: kcChildFolderId,
        kcFileScope: fileScope,
        visibility: scope.visibility,
        teamIds: scope.teamIds,
        projectIds: scope.projectIds,
      });
      this.mergeInsertedIntoResult(result, inserted, siteName);
    } else {
      const siteName = await this.graph.getSiteName(userId, scope.siteId);
      const driveName = await this.graph.getDriveName(
        userId,
        scope.siteId,
        scope.driveId,
      );

      // Same aggregate-then-cap pattern as Drive: count first, fail
      // fast if the user picked too many folders, then write.
      const perFolder: {
        folderId: string;
        folderName: string;
        files: SharePointFileMeta[];
      }[] = [];
      let totalFiles = 0;
      for (const folderId of scope.folderIds) {
        const folderName = await this.graph.getFolderName(
          userId,
          scope.driveId,
          folderId,
        );
        const files = await this.graph.listFiles(
          userId,
          {
            kind: 'folder',
            driveId: scope.driveId,
            folderIds: [folderId],
          },
          MAX_FOLDER_IMPORT_FILES + 1,
        );
        perFolder.push({ folderId, folderName, files });
        totalFiles += files.length;
      }
      this.enforceImportCountCap(totalFiles, 'folder');

      for (const entry of perFolder) {
        const kcChildFolderId = await this.ensureChildFolder(
          userId,
          parentFolderId,
          entry.folderName,
        );
        const inserted = await this.upsertFilesAndSource(userId, {
          files: entry.files,
          sourceScope: 'folder',
          siteId: scope.siteId,
          siteName,
          driveId: scope.driveId,
          driveName,
          folderId: entry.folderId,
          folderName: entry.folderName,
          displayName: entry.folderName,
          connectionId: connection.id,
          kcFolderId: kcChildFolderId,
          kcFileScope: fileScope,
          visibility: scope.visibility,
          teamIds: scope.teamIds,
          projectIds: scope.projectIds,
        });
        this.mergeInsertedIntoResult(result, inserted, entry.folderName);
      }
    }

    await this.oauth.markSynced(userId);

    if (result.added > 0) {
      this.ingestion.ingestPendingFilesForUser(userId);
    }
    return result;
  }

  /**
   * Re-sync an existing source. Reproduces the original visibility
   * settings stored on the source row.
   */
  async resyncSource(
    userId: string,
    sourceId: string,
  ): Promise<SharePointImportResult> {
    const [source] = await this.db
      .select()
      .from(sharepointImportSources)
      .where(
        and(
          eq(sharepointImportSources.id, sourceId),
          eq(sharepointImportSources.ownerId, userId),
        ),
      );
    if (!source) throw new NotFoundException('SharePoint source not found');

    const visibilityExtras = {
      visibility: (source.visibility as SharePointVisibility) ?? undefined,
      teamIds: source.teamIds ?? undefined,
      projectIds: source.projectIds ?? undefined,
    };

    if (source.scope === 'site') {
      return this.importFromSharePoint(userId, {
        kind: 'site',
        siteId: source.siteId,
        ...visibilityExtras,
      });
    }
    if (!source.driveId || !source.folderId) {
      throw new BadRequestException(
        'Folder-scoped source is missing drive or folder id; remove and re-import.',
      );
    }
    return this.importFromSharePoint(userId, {
      kind: 'folder',
      siteId: source.siteId,
      driveId: source.driveId,
      folderIds: [source.folderId],
      ...visibilityExtras,
    });
  }

  async listSources(userId: string): Promise<SharePointSourceRow[]> {
    const rows = await this.db
      .select()
      .from(sharepointImportSources)
      .where(eq(sharepointImportSources.ownerId, userId))
      .orderBy(sql`${sharepointImportSources.lastSyncedAt} DESC`);
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope as 'site' | 'folder',
      siteId: r.siteId,
      siteName: r.siteName,
      driveId: r.driveId,
      driveName: r.driveName,
      folderId: r.folderId,
      folderName: r.folderName,
      displayName:
        r.scope === 'site' ? r.siteName : (r.folderName ?? r.siteName),
      lastSyncedAt: r.lastSyncedAt.toISOString(),
      fileCountAtLastSync: r.fileCountAtLastSync,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async deleteSource(userId: string, sourceId: string): Promise<void> {
    const [source] = await this.db
      .select()
      .from(sharepointImportSources)
      .where(
        and(
          eq(sharepointImportSources.id, sourceId),
          eq(sharepointImportSources.ownerId, userId),
        ),
      );
    if (!source) throw new NotFoundException('SharePoint source not found');
    if (source.ownerId !== userId) throw new ForbiddenException();
    await this.db
      .delete(sharepointImportSources)
      .where(eq(sharepointImportSources.id, sourceId));
  }

  /**
   * Cheap per-site scan that tells the FE roughly how many files
   * would be imported before the user confirms a whole-site import.
   */
  async getFileCountEstimateForSite(
    userId: string,
    siteId: string,
  ): Promise<{ count: number; hasMore: boolean }> {
    this.logger.log(
      `[sp file-count] starting for user ${userId}, site ${siteId}`,
    );
    try {
      const { fileNames, hasMore } = await this.graph.estimateFileCountForSite(
        userId,
        siteId,
      );
      const count = fileNames.filter((n) =>
        UPLOAD_ALLOWED_EXTENSIONS.test(n),
      ).length;
      this.logger.log(
        `[sp file-count] after ext filter: ${count}, hasMore=${hasMore}`,
      );
      return { count, hasMore };
    } catch (err) {
      this.logger.error(
        `[sp file-count] failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Async (progress-tracked) Whole-site import
  // ─────────────────────────────────────────────────────────────────

  startImportSiteAsync(
    userId: string,
    scope: SharePointImportScope,
  ): Promise<{ started: true }> {
    if (scope.kind !== 'site') {
      throw new BadRequestException(
        'Async import is only supported for the "site" scope.',
      );
    }
    validateSharePointScope(scope);

    const existing = this.activeJobs.get(userId);
    if (
      existing &&
      (existing.progress.phase === 'scanning' ||
        existing.progress.phase === 'importing')
    ) {
      throw new ConflictException(
        'A SharePoint import is already in progress. Cancel it first or wait for it to finish.',
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

    void this._runImportSiteJob(userId, scope, job).catch((err) => {
      if (this.activeJobs.get(userId) === job) {
        job.progress.phase = 'error';
        job.progress.error =
          err instanceof Error ? err.message : 'Unknown error';
        this.logger.error(
          `SharePoint async import failed for user ${userId}: ${job.progress.error}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    });
    return Promise.resolve({ started: true } as const);
  }

  getImportProgress(userId: string): SharePointImportProgress | null {
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
          .delete(sharepointImportSources)
          .where(eq(sharepointImportSources.id, job.createdSourceId));
        job.createdSourceId = null;
      }
    }
    this.activeJobs.delete(userId);
  }

  private async _runImportSiteJob(
    userId: string,
    scope: SharePointImportScope & { kind: 'site' },
    job: ActiveImportJob,
  ): Promise<void> {
    try {
      const connection = await this.oauth.requireConnection(userId);
      const parentFolderId = await this.ensureSharePointParentFolder(userId);
      const siteName = await this.graph.getSiteName(userId, scope.siteId);
      const kcChildFolderId = await this.ensureChildFolder(
        userId,
        parentFolderId,
        siteName,
      );

      const [uploader] = await this.db
        .select({ profileType: users.profileType })
        .from(users)
        .where(eq(users.id, userId));
      const fileScope =
        uploader?.profileType === 'company' ? 'company' : 'personal';
      const visibility = scope.visibility ?? 'all';

      // ── Phase 1: Scan ───────────────────────────────────────────
      job.progress.phase = 'scanning';
      let files: SharePointFileMeta[];
      try {
        files = await this.graph.listFiles(
          userId,
          { kind: 'site', siteId: scope.siteId },
          MAX_SITE_IMPORT_FILES + 1,
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

      // Fail fast on cap overflow — matches the sync importFromSharePoint
      // path. `listFiles` was called with `MAX_SITE_IMPORT_FILES + 1` as
      // the soft limit so this comparison is reliable: if we got more
      // than the cap back, the site has more files than we can handle
      // in one go. Silent slice() truncation would have left the user
      // wondering why their "Imported N files" count differed from
      // the file-count estimate they saw in the dialog.
      this.enforceImportCountCap(files.length, 'site');

      // ── Phase 2: Filter + dedupe ────────────────────────────────
      const sizeFiltered = files.filter(
        (f) => f.sizeBytes == null || f.sizeBytes <= MAX_SP_FILE_BYTES,
      );
      const extFiltered = sizeFiltered.filter((f) =>
        UPLOAD_ALLOWED_EXTENSIONS.test(f.name),
      );

      // Dedup by (driveId, itemId) pair — see findExistingSharePointKeys.
      const existingKeys = await this.findExistingSharePointKeys(
        userId,
        extFiltered.map((f) => ({ id: f.id, driveId: f.driveId })),
      );
      const newFiles = extFiltered.filter(
        (f) => !existingKeys.has(this.spKey(f.driveId, f.id)),
      );
      if (job.cancelled) return;

      job.progress.total = newFiles.length;
      job.progress.phase = 'importing';

      // Upsert source row up-front so the FE Re-sync chip appears
      // immediately on the page even mid-import.
      const [existingSource] = await this.db
        .select({
          id: sharepointImportSources.id,
          fileCountAtLastSync: sharepointImportSources.fileCountAtLastSync,
        })
        .from(sharepointImportSources)
        .where(
          and(
            eq(sharepointImportSources.ownerId, userId),
            eq(sharepointImportSources.scope, 'site'),
            eq(sharepointImportSources.siteId, scope.siteId),
          ),
        );

      let sourceId: string;
      if (existingSource) {
        sourceId = existingSource.id;
      } else {
        const [created] = await this.db
          .insert(sharepointImportSources)
          .values({
            ownerId: userId,
            connectionId: connection.id,
            scope: 'site',
            siteId: scope.siteId,
            siteName,
            driveId: null,
            driveName: null,
            folderId: null,
            folderName: null,
            fileCountAtLastSync: 0,
            visibility,
            teamIds: scope.teamIds ?? null,
            projectIds: scope.projectIds ?? null,
          })
          .returning({ id: sharepointImportSources.id });
        sourceId = created.id;
        job.createdSourceId = sourceId;
      }

      // ── Phase 3: Insert in batches of 100 ───────────────────────
      const BATCH_SIZE = 100;
      let totalInserted = 0;
      for (let i = 0; i < newFiles.length; i += BATCH_SIZE) {
        if (job.cancelled) break;
        const batch = newFiles.slice(i, i + BATCH_SIZE);
        const insertedRows = await this.db
          .insert(knowledgeFiles)
          .values(
            batch.map((f) => ({
              folderId: kcChildFolderId,
              name: f.name,
              fileType: this.extFromName(f.name),
              sizeBytes: f.sizeBytes ?? 0,
              storagePath: null,
              uploadedById: userId,
              scope: fileScope,
              visibility,
              source: 'sharepoint' as const,
              externalId: f.id,
              externalUrl: f.webViewLink ?? null,
              externalDriveId: f.driveId,
            })),
          )
          .returning({ id: knowledgeFiles.id });

        for (const row of insertedRows) {
          job.insertedFileIds.push(row.id);
        }
        totalInserted += insertedRows.length;
        job.progress.imported = totalInserted;

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
      if (job.cancelled) return;

      const prevCount = existingSource?.fileCountAtLastSync ?? 0;
      await this.db
        .update(sharepointImportSources)
        .set({
          lastSyncedAt: new Date(),
          fileCountAtLastSync: prevCount + totalInserted,
          siteName,
        })
        .where(eq(sharepointImportSources.id, sourceId));

      await this.db
        .update(knowledgeFolders)
        .set({ updatedAt: new Date() })
        .where(eq(knowledgeFolders.id, kcChildFolderId));

      await this.oauth.markSynced(userId);

      if (totalInserted > 0) {
        this.ingestion.ingestPendingFilesForUser(userId);
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

  private enforceImportCountCap(
    totalFiles: number,
    kind: 'site' | 'folder',
  ): void {
    const cap =
      kind === 'site' ? MAX_SITE_IMPORT_FILES : MAX_FOLDER_IMPORT_FILES;
    if (totalFiles > cap) {
      throw new BadRequestException(
        kind === 'site'
          ? `This SharePoint site has more than ${cap.toLocaleString()} supported files — the per-import cap is ${cap.toLocaleString()}. Pick specific folders or contact support.`
          : `This folder selection contains ${totalFiles} files — the cap is ${cap.toLocaleString()} per import. Pick fewer folders.`,
      );
    }
  }

  private mergeInsertedIntoResult(
    result: SharePointImportResult,
    inserted: {
      sourceId: string;
      added: number;
      skippedDuplicates: number;
      skippedTooLarge: number;
      skippedUnsupported: number;
    },
    displayName: string,
  ): void {
    result.added += inserted.added;
    result.skippedDuplicates += inserted.skippedDuplicates;
    result.skippedTooLarge += inserted.skippedTooLarge;
    result.skippedUnsupported += inserted.skippedUnsupported;
    result.sources.push({ id: inserted.sourceId, displayName });
  }

  /** `${driveId}:${itemId}` — the dedup key used in JS-side filtering. */
  private spKey(driveId: string, itemId: string): string {
    return `${driveId}:${itemId}`;
  }

  /**
   * Look up which `(driveId, itemId)` pairs the user already has
   * imported, so the import path can skip them. Probes the new
   * `knowledge_files_owner_sp_external_unique` partial index added in
   * migration 0006 — the SharePoint-specific dedup key is the
   * (driveId, itemId) PAIR because SharePoint item ids are
   * drive-scoped (the same itemId can appear in two libraries).
   *
   * Batches candidate pairs in groups of 500 to stay well under the
   * Postgres parameter limit (~32 760 default `max_locks_per_transaction`
   * × ~32 767 bind parameters per query). 500 pairs × 2 params each =
   * 1 000 params/batch — comfortably safe and one query per ~500
   * incoming files is fine perf-wise.
   */
  private async findExistingSharePointKeys(
    userId: string,
    candidates: ReadonlyArray<{ id: string; driveId: string }>,
  ): Promise<Set<string>> {
    if (candidates.length === 0) return new Set();
    const found = new Set<string>();
    const CHUNK = 500;
    for (let i = 0; i < candidates.length; i += CHUNK) {
      const batch = candidates.slice(i, i + CHUNK);
      const pairs = batch.map((c) =>
        and(
          eq(knowledgeFiles.externalDriveId, c.driveId),
          eq(knowledgeFiles.externalId, c.id),
        ),
      );
      const rows = await this.db
        .select({
          externalDriveId: knowledgeFiles.externalDriveId,
          externalId: knowledgeFiles.externalId,
        })
        .from(knowledgeFiles)
        .where(
          and(
            eq(knowledgeFiles.uploadedById, userId),
            eq(knowledgeFiles.source, 'sharepoint'),
            or(...pairs),
          ),
        );
      for (const r of rows) {
        if (r.externalDriveId && r.externalId) {
          found.add(this.spKey(r.externalDriveId, r.externalId));
        }
      }
    }
    return found;
  }

  private async ensureSharePointParentFolder(userId: string): Promise<string> {
    const [existing] = await this.db
      .select({ id: knowledgeFolders.id })
      .from(knowledgeFolders)
      .where(
        and(
          eq(knowledgeFolders.ownerId, userId),
          eq(knowledgeFolders.name, SP_PARENT_FOLDER_NAME),
          sql`${knowledgeFolders.parentFolderId} IS NULL`,
        ),
      );
    if (existing) return existing.id;
    const [created] = await this.db
      .insert(knowledgeFolders)
      .values({
        name: SP_PARENT_FOLDER_NAME,
        ownerId: userId,
        parentFolderId: null,
      })
      .returning({ id: knowledgeFolders.id });
    return created.id;
  }

  /**
   * TODO(follow-up): nest folder-scope imports one level deeper
   * (`SharePoint > {siteName} > {folderName}`) so two SharePoint
   * folders with the same display name in different sites don't
   * collapse into a single KC folder. Same limitation exists on
   * the Google Drive integration today (it has been in production
   * without complaints), so fixing only SharePoint would be
   * inconsistent — wait for a unified fix across both providers.
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

  private async upsertFilesAndSource(
    userId: string,
    args: {
      files: SharePointFileMeta[];
      sourceScope: 'site' | 'folder';
      siteId: string;
      siteName: string;
      driveId: string | null;
      driveName: string | null;
      folderId: string | null;
      folderName: string | null;
      displayName: string;
      connectionId: string;
      kcFolderId: string;
      kcFileScope: string;
      visibility?: SharePointVisibility;
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
    const sizeFilteredFiles: SharePointFileMeta[] = [];
    let skippedTooLarge = 0;
    for (const f of args.files) {
      if (f.sizeBytes != null && f.sizeBytes > MAX_SP_FILE_BYTES) {
        skippedTooLarge++;
        continue;
      }
      sizeFilteredFiles.push(f);
    }

    const ingestionReadyFiles: SharePointFileMeta[] = [];
    let skippedUnsupported = 0;
    for (const f of sizeFilteredFiles) {
      if (!UPLOAD_ALLOWED_EXTENSIONS.test(f.name)) {
        skippedUnsupported++;
        continue;
      }
      ingestionReadyFiles.push(f);
    }

    // Dedup by (driveId, itemId) pair — see findExistingSharePointKeys.
    const existingKeys = await this.findExistingSharePointKeys(
      userId,
      ingestionReadyFiles.map((f) => ({ id: f.id, driveId: f.driveId })),
    );
    const newFiles = ingestionReadyFiles.filter(
      (f) => !existingKeys.has(this.spKey(f.driveId, f.id)),
    );

    // Upsert source row. Dispatch by scope — the partial unique
    // indexes target different column tuples for site vs folder.
    // Folder-scope callers MUST provide driveId AND folderId — assert
    // up-front rather than coercing NULLs to '' (which would silently
    // miss an existing row and force a duplicate INSERT that the
    // partial unique index would then reject with 23505).
    if (args.sourceScope === 'folder') {
      if (!args.driveId || !args.folderId) {
        throw new Error(
          `upsertFilesAndSource: folder-scope source for site ${args.siteId} ` +
            `is missing driveId (${args.driveId ?? 'null'}) or folderId ` +
            `(${args.folderId ?? 'null'}). This is a programming error.`,
        );
      }
    }
    let sourceId: string;
    const [existingSource] = await this.db
      .select({
        id: sharepointImportSources.id,
        fileCountAtLastSync: sharepointImportSources.fileCountAtLastSync,
      })
      .from(sharepointImportSources)
      .where(
        and(
          eq(sharepointImportSources.ownerId, userId),
          eq(sharepointImportSources.scope, args.sourceScope),
          eq(sharepointImportSources.siteId, args.siteId),
          args.sourceScope === 'folder'
            ? and(
                eq(sharepointImportSources.driveId, args.driveId as string),
                eq(sharepointImportSources.folderId, args.folderId as string),
              )
            : sql`true`,
        ),
      );

    if (existingSource) {
      const updatedCount = existingSource.fileCountAtLastSync + newFiles.length;
      await this.db
        .update(sharepointImportSources)
        .set({
          lastSyncedAt: new Date(),
          fileCountAtLastSync: updatedCount,
          siteName: args.siteName,
          driveName: args.driveName,
          folderName: args.folderName,
        })
        .where(eq(sharepointImportSources.id, existingSource.id));
      sourceId = existingSource.id;
    } else {
      const [inserted] = await this.db
        .insert(sharepointImportSources)
        .values({
          ownerId: userId,
          connectionId: args.connectionId,
          scope: args.sourceScope,
          siteId: args.siteId,
          siteName: args.siteName,
          driveId: args.driveId,
          driveName: args.driveName,
          folderId: args.folderId,
          folderName: args.folderName,
          fileCountAtLastSync: newFiles.length,
          visibility: args.visibility ?? 'all',
          teamIds: args.teamIds ?? null,
          projectIds: args.projectIds ?? null,
        })
        .returning({ id: sharepointImportSources.id });
      sourceId = inserted.id;
    }

    if (newFiles.length === 0) {
      return {
        sourceId,
        added: 0,
        skippedDuplicates: existingKeys.size,
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
          source: 'sharepoint' as const,
          externalId: f.id,
          externalUrl: f.webViewLink ?? null,
          externalDriveId: f.driveId,
        })),
      )
      .returning({ id: knowledgeFiles.id });

    const visibility = args.visibility ?? 'all';
    if (visibility === 'teams' && (args.teamIds ?? []).length > 0) {
      await this.db.insert(knowledgeFileTeams).values(
        insertedFiles.flatMap((row) =>
          (args.teamIds ?? []).map((teamId) => ({
            fileId: row.id,
            teamId,
          })),
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

    await this.db
      .update(knowledgeFolders)
      .set({ updatedAt: new Date() })
      .where(eq(knowledgeFolders.id, args.kcFolderId));

    return {
      sourceId,
      added: newFiles.length,
      skippedDuplicates: existingKeys.size,
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
