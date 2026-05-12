import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq, desc, inArray, sql } from 'drizzle-orm';
import {
  knowledgeFolders,
  knowledgeFiles,
  knowledgeChunks,
  users,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

@Injectable()
export class KnowledgeCoreService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly knowledgeIngestion: KnowledgeIngestionService,
  ) {}

  async findAllFolders(userId: string) {
    const rows = await this.db
      .select({
        id: knowledgeFolders.id,
        name: knowledgeFolders.name,
        ownerId: knowledgeFolders.ownerId,
        createdAt: knowledgeFolders.createdAt,
        updatedAt: knowledgeFolders.updatedAt,
        fileCount: sql<string>`count(${knowledgeFiles.id})`.as('file_count'),
        totalBytes: sql<string>`coalesce(sum(${knowledgeFiles.sizeBytes}), 0)`.as(
          'total_bytes',
        ),
      })
      .from(knowledgeFolders)
      .leftJoin(
        knowledgeFiles,
        eq(knowledgeFiles.folderId, knowledgeFolders.id),
      )
      .where(eq(knowledgeFolders.ownerId, userId))
      .groupBy(
        knowledgeFolders.id,
        knowledgeFolders.name,
        knowledgeFolders.ownerId,
        knowledgeFolders.createdAt,
        knowledgeFolders.updatedAt,
      )
      .orderBy(desc(knowledgeFolders.updatedAt));

    return rows.map((r) => ({
      ...r,
      fileCount: Number(r.fileCount),
      totalBytes: Number(r.totalBytes),
    }));
  }

  async findFolder(id: string, userId: string) {
    const [folder] = await this.db
      .select()
      .from(knowledgeFolders)
      .where(eq(knowledgeFolders.id, id));

    if (!folder) throw new NotFoundException('Folder not found');
    if (folder.ownerId !== userId) throw new ForbiddenException('Access denied');

    const files = await this.db
      .select({
        id: knowledgeFiles.id,
        folderId: knowledgeFiles.folderId,
        name: knowledgeFiles.name,
        fileType: knowledgeFiles.fileType,
        sizeBytes: knowledgeFiles.sizeBytes,
        storagePath: knowledgeFiles.storagePath,
        uploadedById: knowledgeFiles.uploadedById,
        uploadedByName: users.name,
        // Surface ingestion status so the FE can render the per-file
        // training badge without a second round-trip.
        ingestionStatus: knowledgeFiles.ingestionStatus,
        ingestionError: knowledgeFiles.ingestionError,
        // Surfaced so the row UI can render the 'Admin only' badge
        // and the action menu can flip it via PATCH.
        visibility: knowledgeFiles.visibility,
        createdAt: knowledgeFiles.createdAt,
      })
      .from(knowledgeFiles)
      .leftJoin(users, eq(users.id, knowledgeFiles.uploadedById))
      .where(eq(knowledgeFiles.folderId, id))
      .orderBy(desc(knowledgeFiles.createdAt));

    return { ...folder, files };
  }

  async createFolder(name: string, userId: string) {
    const [folder] = await this.db
      .insert(knowledgeFolders)
      .values({ name: name.trim(), ownerId: userId })
      .returning();
    return folder;
  }

  async deleteFolder(id: string, userId: string) {
    const [folder] = await this.db
      .select()
      .from(knowledgeFolders)
      .where(eq(knowledgeFolders.id, id));

    if (!folder) throw new NotFoundException('Folder not found');
    if (folder.ownerId !== userId)
      throw new ForbiddenException('Access denied');

    const fileRows = await this.db
      .select({ storagePath: knowledgeFiles.storagePath })
      .from(knowledgeFiles)
      .where(eq(knowledgeFiles.folderId, id));

    await this.db
      .delete(knowledgeFolders)
      .where(eq(knowledgeFolders.id, id));

    await Promise.allSettled(
      fileRows.map(async ({ storagePath }) => {
        if (!storagePath) return;
        try {
          await fs.promises.unlink(
            path.resolve(process.cwd(), storagePath),
          );
        } catch {
          // File may already be removed
        }
      }),
    );
  }

  async uploadFiles(
    folderId: string,
    userId: string,
    files: Express.Multer.File[],
    visibilityInput?: string,
  ) {
    const [folder] = await this.db
      .select()
      .from(knowledgeFolders)
      .where(eq(knowledgeFolders.id, folderId));

    if (!folder) throw new NotFoundException('Folder not found');
    if (folder.ownerId !== userId) throw new ForbiddenException('Access denied');

    // Visibility for chat-time RAG search: company-profile uploaders
    // make their files org-wide ('company'); personal-profile keep
    // them private ('personal'). One round-trip to read profileType +
    // role is fine — uploads aren't a hot path. Role check is needed
    // a few lines below to gate the 'admins' visibility privilege.
    const [uploader] = await this.db
      .select({ profileType: users.profileType, role: users.role })
      .from(users)
      .where(eq(users.id, userId));
    const scope =
      uploader?.profileType === 'company' ? 'company' : 'personal';

    // Secondary visibility within the scope. Default 'all' keeps
    // legacy behaviour. 'admins' is a privilege — only an admin can
    // promote an upload to admin-only at creation time. Force 'all'
    // for anyone else so a basic user can't sneak in an admin-only
    // upload via crafted multipart fields. Validate the enum so any
    // typo from the client surfaces as a clear 400 instead of being
    // silently coerced to 'all'.
    const visibility = this.resolveUploadVisibility(
      visibilityInput,
      uploader?.role,
    );

    const values = files.map((file) => {
      const ext = path.extname(file.originalname).replace('.', '').toUpperCase();
      const fileType = ext || 'FILE';
      return {
        folderId,
        name: file.originalname,
        fileType,
        sizeBytes: file.size,
        storagePath: path.posix.join(
          'uploads/knowledge-core',
          path.basename(file.path),
        ),
        uploadedById: userId,
        scope,
        visibility,
      };
    });

    try {
      const inserted = values.length
        ? await this.db.insert(knowledgeFiles).values(values).returning()
        : [];

      await this.db
        .update(knowledgeFolders)
        .set({ updatedAt: new Date() })
        .where(eq(knowledgeFolders.id, folderId));

      // Kick off chunk + embed in the background. Same fire-and-
      // forget pattern as onboarding ingestion — the HTTP response
      // returns immediately while the worker processes the rows we
      // just inserted (visible to it because the INSERT above
      // committed). FE polls or refetches the file list to surface
      // the per-file status badge.
      if (inserted.length > 0) {
        this.knowledgeIngestion.ingestPendingFilesForUser(userId);
      }

      return inserted;
    } catch (error) {
      await Promise.allSettled(
        files
          .filter((file) => file.path)
          .map((file) => fs.promises.unlink(file.path)),
      );
      throw error;
    }
  }

  /**
   * Validate the visibility enum + enforce the admin-only privilege
   * for 'admins'. Shared between upload and PATCH so the same gate
   * applies regardless of how a row gets flipped.
   */
  private resolveUploadVisibility(
    input: string | undefined,
    callerRole: string | null | undefined,
  ): 'all' | 'admins' {
    if (input == null || input === '') return 'all';
    if (input !== 'all' && input !== 'admins') {
      throw new BadRequestException(
        `Invalid visibility "${input}". Must be 'all' or 'admins'.`,
      );
    }
    if (input === 'admins' && callerRole !== 'admin') {
      throw new ForbiddenException(
        'Only admins can mark a knowledge file as admin-only.',
      );
    }
    return input;
  }

  /**
   * Force a fresh ingestion pass for a single file. The /knowledge-core
   * UI exposes this as a "Retrain" action on each row; useful after
   * we change the parser / chunker (or when an earlier run landed
   * with 'No extractable text' before the buffer-and-flush fix and
   * the chunks are missing). Replaces the workaround of uploading a
   * dummy file just to trigger `ingestPendingFilesForUser`.
   *
   * Semantics:
   *   - Owner only — the same gate that protects every other
   *     mutation on the file. Admin can re-train indirectly by
   *     uploading replacements; cross-owner re-train would be a
   *     privilege escalation we don't want to grant by default.
   *   - Blocked when the file is already mid-ingestion
   *     (status='processing') so we don't race the worker.
   *   - Deletes existing chunks for the file inside a transaction so
   *     RAG search never sees half-old + half-new vectors. The chunk
   *     count drop is fine — `searchAccessibleChunks` filters at
   *     query time, so an empty file briefly returns no context
   *     (acceptable; the worker re-fills within seconds).
   *   - Fire-and-forget worker kick — the HTTP response returns as
   *     soon as the row is reset; the FE polls / refetches to
   *     surface the new status badge.
   */
  async reingestFile(fileId: string, callerId: string) {
    const [file] = await this.db
      .select({
        id: knowledgeFiles.id,
        folderId: knowledgeFiles.folderId,
        ingestionStatus: knowledgeFiles.ingestionStatus,
        ownerId: knowledgeFolders.ownerId,
      })
      .from(knowledgeFiles)
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .where(eq(knowledgeFiles.id, fileId));

    if (!file) throw new NotFoundException('File not found');
    if (file.ownerId !== callerId) {
      throw new ForbiddenException('Access denied');
    }
    if (file.ingestionStatus === 'processing') {
      throw new BadRequestException(
        'This file is already being trained. Try again once the current run finishes.',
      );
    }

    await this.db.transaction(async (tx) => {
      // Drop existing chunks first so RAG search doesn't briefly
      // pull stale content alongside the freshly-embedded one once
      // the worker starts inserting. Cascade isn't enough here —
      // the file row stays, only the chunks turn over.
      await tx
        .delete(knowledgeChunks)
        .where(eq(knowledgeChunks.fileId, fileId));
      await tx
        .update(knowledgeFiles)
        .set({
          ingestionStatus: 'pending',
          ingestionError: null,
          ingestionCompletedAt: null,
        })
        .where(eq(knowledgeFiles.id, fileId));
    });

    // Worker claims every pending row this user owns — if other
    // files also happen to be pending, they get re-processed too.
    // That's fine: the FE polls per-file and shows each badge
    // independently. Fire-and-forget so the HTTP response returns.
    this.knowledgeIngestion.ingestPendingFilesForUser(callerId);

    return { id: fileId, ingestionStatus: 'pending' as const };
  }

  /**
   * Flip an existing file's visibility between 'all' and 'admins'.
   * Admin-only — non-admins can't elevate (would be a privilege
   * escalation) nor demote (no good reason; admin owns the curation).
   * Mirrored onto knowledge_chunks so the RAG filter (which only
   * reads chunks, never re-JOINs to the file row) immediately
   * respects the new setting.
   */
  async updateFileVisibility(
    fileId: string,
    callerId: string,
    visibilityInput: string,
  ) {
    const [caller] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, callerId));
    if (caller?.role !== 'admin') {
      throw new ForbiddenException(
        'Only admins can change a file\'s visibility.',
      );
    }
    if (visibilityInput !== 'all' && visibilityInput !== 'admins') {
      throw new BadRequestException(
        `Invalid visibility "${visibilityInput}". Must be 'all' or 'admins'.`,
      );
    }

    const [file] = await this.db
      .select({
        id: knowledgeFiles.id,
        folderId: knowledgeFiles.folderId,
        ingestionStatus: knowledgeFiles.ingestionStatus,
      })
      .from(knowledgeFiles)
      .where(eq(knowledgeFiles.id, fileId));
    if (!file) throw new NotFoundException('File not found');
    // Block visibility flips while the worker is mid-ingestion.
    // KnowledgeIngestionService captures `visibility` at claim time
    // and inserts chunks with that captured value — if we updated the
    // file row + (still-empty) chunks rowset here, the worker's later
    // INSERT would land chunks at the stale visibility and leave
    // file.visibility and chunks.visibility out of sync. Mirror the
    // same guard reingestFile uses; the admin retries in a second.
    if (file.ingestionStatus === 'processing') {
      throw new BadRequestException(
        'This file is being trained right now. Try again once the current run finishes.',
      );
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(knowledgeFiles)
        .set({ visibility: visibilityInput })
        .where(eq(knowledgeFiles.id, fileId));
      await tx
        .update(knowledgeChunks)
        .set({ visibility: visibilityInput })
        .where(eq(knowledgeChunks.fileId, fileId));
    });

    return { id: fileId, visibility: visibilityInput };
  }

  /**
   * Bulk variant of `updateFileVisibility`. Same gates (admin-only,
   * enum validation), one transaction so a partial run can't leave
   * the user in a half-flipped state. Drops unknown / invalid IDs
   * silently (caller-side typically constructs the array from rows
   * it already rendered, so the only way IDs go stale is concurrent
   * deletes — surfacing a 404 in that race would be misleading).
   *
   * Returns the affected ids so the FE knows exactly which rows to
   * optimistically update.
   */
  async updateFilesVisibility(
    fileIds: string[],
    callerId: string,
    visibilityInput: string,
  ) {
    const [caller] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, callerId));
    if (caller?.role !== 'admin') {
      throw new ForbiddenException(
        'Only admins can change a file\'s visibility.',
      );
    }
    if (visibilityInput !== 'all' && visibilityInput !== 'admins') {
      throw new BadRequestException(
        `Invalid visibility "${visibilityInput}". Must be 'all' or 'admins'.`,
      );
    }
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      throw new BadRequestException('`fileIds` must be a non-empty array.');
    }

    // Cheap dedupe in case the FE accidentally sends duplicates;
    // drizzle inArray would still work but we'd update twice.
    const uniqueIds = Array.from(new Set(fileIds));

    // Same race as the per-file path: a row that's mid-ingestion has
    // a worker about to insert chunks with the captured (stale)
    // visibility. Updating the file row + (still-empty) chunks set
    // here would leave them out of sync. Skip processing rows
    // entirely so the rest of the batch still flips, and return the
    // skipped ids so the FE can surface a partial-success toast.
    const statuses = await this.db
      .select({
        id: knowledgeFiles.id,
        ingestionStatus: knowledgeFiles.ingestionStatus,
      })
      .from(knowledgeFiles)
      .where(inArray(knowledgeFiles.id, uniqueIds));
    const eligibleIds: string[] = [];
    const skippedIds: string[] = [];
    for (const row of statuses) {
      if (row.ingestionStatus === 'processing') skippedIds.push(row.id);
      else eligibleIds.push(row.id);
    }

    // UPDATE ... RETURNING gives us the actual rows touched, in
    // case a row was deleted between the status SELECT above and
    // the UPDATE here. Returning the real affected ids keeps the
    // FE's optimistic state honest.
    let affectedIds: string[] = [];
    if (eligibleIds.length > 0) {
      await this.db.transaction(async (tx) => {
        const updated = await tx
          .update(knowledgeFiles)
          .set({ visibility: visibilityInput })
          .where(inArray(knowledgeFiles.id, eligibleIds))
          .returning({ id: knowledgeFiles.id });
        affectedIds = updated.map((r) => r.id);
        if (affectedIds.length > 0) {
          await tx
            .update(knowledgeChunks)
            .set({ visibility: visibilityInput })
            .where(inArray(knowledgeChunks.fileId, affectedIds));
        }
      });
    }

    return {
      visibility: visibilityInput as 'all' | 'admins',
      affectedIds,
      skippedIds,
    };
  }

  async getFileForDownload(fileId: string, userId: string) {
    const [file] = await this.db
      .select({
        id: knowledgeFiles.id,
        name: knowledgeFiles.name,
        storagePath: knowledgeFiles.storagePath,
        ownerId: knowledgeFolders.ownerId,
      })
      .from(knowledgeFiles)
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .where(eq(knowledgeFiles.id, fileId));

    if (!file) throw new NotFoundException('File not found');
    if (file.ownerId !== userId) throw new ForbiddenException('Access denied');
    if (!file.storagePath) throw new NotFoundException('File not on disk');

    return {
      name: file.name,
      storagePath: path.resolve(process.cwd(), file.storagePath),
    };
  }

  async moveFile(fileId: string, targetFolderId: string, userId: string) {
    const [file] = await this.db
      .select({
        id: knowledgeFiles.id,
        folderId: knowledgeFiles.folderId,
        ownerId: knowledgeFolders.ownerId,
      })
      .from(knowledgeFiles)
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .where(eq(knowledgeFiles.id, fileId));

    if (!file) throw new NotFoundException('File not found');
    if (file.ownerId !== userId) throw new ForbiddenException('Access denied');

    const [targetFolder] = await this.db
      .select()
      .from(knowledgeFolders)
      .where(eq(knowledgeFolders.id, targetFolderId));

    if (!targetFolder) throw new NotFoundException('Target folder not found');
    if (targetFolder.ownerId !== userId)
      throw new ForbiddenException('Access denied');

    await this.db
      .update(knowledgeFiles)
      .set({ folderId: targetFolderId })
      .where(eq(knowledgeFiles.id, fileId));

    await this.db
      .update(knowledgeFolders)
      .set({ updatedAt: new Date() })
      .where(eq(knowledgeFolders.id, targetFolderId));

    await this.db
      .update(knowledgeFolders)
      .set({ updatedAt: new Date() })
      .where(eq(knowledgeFolders.id, file.folderId));
  }

  async deleteFile(fileId: string, userId: string) {
    const [file] = await this.db
      .select({
        id: knowledgeFiles.id,
        storagePath: knowledgeFiles.storagePath,
        folderId: knowledgeFiles.folderId,
        ownerId: knowledgeFolders.ownerId,
      })
      .from(knowledgeFiles)
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .where(eq(knowledgeFiles.id, fileId));

    if (!file) throw new NotFoundException('File not found');
    if (file.ownerId !== userId) throw new ForbiddenException('Access denied');

    if (file.storagePath) {
      try {
        await fs.promises.unlink(path.resolve(process.cwd(), file.storagePath));
      } catch {
        // File may already be removed from disk
      }
    }

    await this.db.delete(knowledgeFiles).where(eq(knowledgeFiles.id, fileId));

    await this.db
      .update(knowledgeFolders)
      .set({ updatedAt: new Date() })
      .where(eq(knowledgeFolders.id, file.folderId));
  }

  async recentFiles(userId: string) {
    const rows = await this.db
      .select({
        id: knowledgeFiles.id,
        name: knowledgeFiles.name,
        fileType: knowledgeFiles.fileType,
        sizeBytes: knowledgeFiles.sizeBytes,
        folderName: knowledgeFolders.name,
        uploadedByName: users.name,
        ingestionStatus: knowledgeFiles.ingestionStatus,
        ingestionError: knowledgeFiles.ingestionError,
        visibility: knowledgeFiles.visibility,
        createdAt: knowledgeFiles.createdAt,
      })
      .from(knowledgeFiles)
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .leftJoin(users, eq(users.id, knowledgeFiles.uploadedById))
      .where(eq(knowledgeFolders.ownerId, userId))
      .orderBy(desc(knowledgeFiles.createdAt))
      .limit(10);

    return rows;
  }
}
