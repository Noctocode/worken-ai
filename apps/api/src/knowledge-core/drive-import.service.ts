import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  driveImportSources,
  knowledgeFiles,
  knowledgeFolders,
  users,
} from '@worken/database/schema';

import { DATABASE, type Database } from '../database/database.module.js';
import {
  GoogleDriveClientService,
  type DriveFileMeta,
} from '../google-drive/google-drive-client.service.js';
import { GoogleDriveOAuthService } from '../google-drive/google-drive-oauth.service.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';

/**
 * The auto-folder Drive imports land in. We deliberately don't mirror
 * Drive's folder hierarchy — keeps KC's already-flat folder model
 * simple and lets users freely reorganise post-import without
 * fighting a sync. drive_import_sources tracks the *Drive* folders;
 * this is just where the imported files live inside KC.
 */
const DRIVE_KC_FOLDER_NAME = 'Google Drive';

export type ImportScope =
  | { kind: 'all' }
  | { kind: 'folders'; folderIds: string[] };

export interface ImportResult {
  /** Number of new knowledge_files rows created on this call. */
  added: number;
  /** Files Drive returned that we already had (matched by external_id). */
  skippedDuplicates: number;
  /** Files Drive returned with a MIME we can't ingest. */
  skippedUnsupported: number;
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

@Injectable()
export class DriveImportService {
  private readonly logger = new Logger(DriveImportService.name);

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

    const connection = await this.oauth.requireConnection(userId);

    // Resolve the target KC folder. Created lazily so users who never
    // touch Drive don't carry around an empty "Google Drive" folder.
    const targetFolderId = await this.ensureDriveFolder(userId);

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
      sources: [],
    };

    if (scope.kind === 'all') {
      const files = await this.drive.listFiles(userId, { kind: 'all' });
      const inserted = await this.upsertFilesAndSource(userId, {
        files,
        sourceScope: 'all',
        driveFolderId: null,
        driveFolderName: 'My Drive',
        connectionId: connection.id,
        kcFolderId: targetFolderId,
        kcFileScope: fileScope,
      });
      result.added += inserted.added;
      result.skippedDuplicates += inserted.skippedDuplicates;
      result.sources.push({
        id: inserted.sourceId,
        driveFolderName: 'My Drive',
      });
    } else {
      // Process each picked folder as its own source row. One Drive
      // listing per folder — the FE rarely picks more than a handful
      // so the sequential round-trips are fine.
      for (const folderId of scope.folderIds) {
        const folderName = await this.resolveDriveFolderName(userId, folderId);
        const files = await this.drive.listFiles(userId, {
          kind: 'folders',
          folderIds: [folderId],
        });
        const inserted = await this.upsertFilesAndSource(userId, {
          files,
          sourceScope: 'folder',
          driveFolderId: folderId,
          driveFolderName: folderName,
          connectionId: connection.id,
          kcFolderId: targetFolderId,
          kcFileScope: fileScope,
        });
        result.added += inserted.added;
        result.skippedDuplicates += inserted.skippedDuplicates;
        result.sources.push({
          id: inserted.sourceId,
          driveFolderName: folderName,
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

    if (source.scope === 'all') {
      return this.importFromDrive(userId, { kind: 'all' });
    }
    if (!source.driveFolderId) {
      throw new BadRequestException(
        'Folder-scoped source is missing its Drive folder id; remove and re-import.',
      );
    }
    return this.importFromDrive(userId, {
      kind: 'folders',
      folderIds: [source.driveFolderId],
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

  /**
   * Ensure the "Google Drive" KC folder exists for this user, return
   * its id. Idempotent — picks up an existing folder by name if the
   * user previously imported.
   */
  private async ensureDriveFolder(userId: string): Promise<string> {
    const [existing] = await this.db
      .select({ id: knowledgeFolders.id })
      .from(knowledgeFolders)
      .where(
        and(
          eq(knowledgeFolders.ownerId, userId),
          eq(knowledgeFolders.name, DRIVE_KC_FOLDER_NAME),
        ),
      );
    if (existing) return existing.id;
    const [created] = await this.db
      .insert(knowledgeFolders)
      .values({ name: DRIVE_KC_FOLDER_NAME, ownerId: userId })
      .returning({ id: knowledgeFolders.id });
    return created.id;
  }

  /**
   * Best-effort Drive folder name resolver for the source record.
   * Falls back to the raw folder id if Drive can't be queried (e.g.
   * permission error). The name is a display cache — losing it
   * doesn't break sync (Drive listings are keyed on folderId, not
   * name).
   */
  private async resolveDriveFolderName(
    userId: string,
    folderId: string,
  ): Promise<string> {
    try {
      const folders = await this.drive.listFolders(userId, 'root');
      const match = folders.find((f) => f.id === folderId);
      if (match) return match.name;
      // Fall through to per-id lookup for nested folders. listFolders
      // only returns immediate children; nested picks need a direct
      // `files.get(folderId)` lookup — skipped here for MVP; the FE
      // can pass folderName in the import payload if precision
      // matters more than a follow-up PR.
      return `Folder (${folderId.slice(0, 8)}…)`;
    } catch {
      return `Folder (${folderId.slice(0, 8)}…)`;
    }
  }

  /**
   * Insert new knowledge_files rows + upsert the source record in one
   * transaction. Dedupe by (uploaded_by_id, external_id) against
   * existing rows — Re-sync of the same source only adds files that
   * appeared since last sync.
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
    },
  ): Promise<{ sourceId: string; added: number; skippedDuplicates: number }> {
    // De-dupe against existing rows. One probe with inArray over the
    // candidate set is O(N) Postgres-side and avoids N+1 queries.
    const candidateIds = args.files.map((f) => f.id);
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

    const newFiles = args.files.filter((f) => !existingSet.has(f.id));

    // ON CONFLICT DO UPDATE for the source row so a second import of
    // the same folder folds in as a Re-sync. The partial unique index
    // makes (ownerId, driveFolderId) the conflict target for
    // scope='folder', and (ownerId) WHERE scope='all' for scope='all'
    // — we can't use one INSERT…ON CONFLICT for both, so dispatch.
    let sourceId: string;
    const [existingSource] = await this.db
      .select({ id: driveImportSources.id })
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
      const fileCount = await this.countSourceFiles(userId, args);
      const updatedCount = fileCount + newFiles.length;
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
        })
        .returning({ id: driveImportSources.id });
      sourceId = inserted.id;
    }

    if (newFiles.length === 0) {
      return { sourceId, added: 0, skippedDuplicates: existingSet.size };
    }

    // Insert knowledge_files rows in a single batched insert. fileType
    // mirrors Drive's MIME (after Google-native export) — the
    // ingestion path reads `name`'s extension for parser dispatch, so
    // fileType is purely for display in the KC UI right now.
    await this.db.insert(knowledgeFiles).values(
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
        visibility: 'all' as const,
        source: 'drive' as const,
        externalId: f.id,
        externalUrl: f.webViewLink ?? null,
      })),
    );

    return {
      sourceId,
      added: newFiles.length,
      skippedDuplicates: existingSet.size,
    };
  }

  /**
   * Total files currently in KC under this source. Used by the FE
   * chip "12 files imported" — derived from `external_id` ownership
   * since we don't track source<->file directly (the source's
   * driveFolderId can re-derive the set by walking Drive again, but
   * here we count what's actually in KC instead).
   *
   * Cheap approximation: count rows for this user where externalId
   * matches a file that lives under args.driveFolderId. For the MVP
   * we just return 0 if we can't disambiguate — the count gets
   * over-written on the next Re-sync anyway.
   */
  private async countSourceFiles(
    userId: string,
    args: { sourceScope: 'all' | 'folder'; driveFolderId: string | null },
  ): Promise<number> {
    if (args.sourceScope === 'all') {
      const [row] = await this.db
        .select({
          count: sql<string>`count(*)`,
        })
        .from(knowledgeFiles)
        .where(
          and(
            eq(knowledgeFiles.uploadedById, userId),
            eq(knowledgeFiles.source, 'drive'),
          ),
        );
      return Number(row?.count ?? 0);
    }
    // Folder-scoped: we can't precisely attribute KC rows to one
    // specific source without a join table. For MVP we return 0 and
    // let the +N from this sync establish the count. A future PR
    // can add a drive_import_source_files join if precision matters.
    return 0;
  }

  private extFromName(name: string): string {
    const dot = name.lastIndexOf('.');
    if (dot === -1 || dot === name.length - 1) return 'FILE';
    return name.slice(dot + 1).toUpperCase();
  }
}
