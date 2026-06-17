import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import {
  KnowledgeCoreService,
  type NameConflictAction,
} from './knowledge-core.service.js';
import {
  DriveImportService,
  type ImportScope,
} from './drive-import.service.js';
import {
  OneDriveImportService,
  type OneDriveImportScope,
} from './onedrive-import.service.js';
import {
  SharePointImportService,
  type SharePointImportScope,
} from './sharepoint-import.service.js';
import { uploadFileFilter } from './upload-allowlist.js';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'knowledge-core');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function sanitizeFilename(name: string): string {
  // \x00-\x1f are exactly what we're stripping — they're filesystem-
  // illegal on Windows and can hide path-traversal payloads on Unix,
  // so the control-char range is the entire point of the regex.
  // eslint-disable-next-line no-control-regex
  return name.replace(/[/\\:*?"<>|\x00-\x1f]/g, '_');
}

@Controller('knowledge-core')
export class KnowledgeCoreController {
  constructor(
    private readonly service: KnowledgeCoreService,
    private readonly driveImport: DriveImportService,
    private readonly sharepointImport: SharePointImportService,
    private readonly onedriveImport: OneDriveImportService,
  ) {}

  @Get('folders')
  findAllFolders(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findAllFolders(user.id);
  }

  // Flat list of every file the user owns — backs the "All files"
  // option in the Manage Context attach picker. Declared before the
  // `files/:id/...` routes; an exact-path GET can't be shadowed by
  // the parameterized ones, but keeping it here documents the intent.
  @Get('files')
  findAllFiles(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findAllFiles(user.id);
  }

  @Get('folders/:id')
  findFolder(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.findFolder(id, user.id);
  }

  @Post('folders')
  createFolder(
    @Body() body: { name: string; parentFolderId?: string | null },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      throw new BadRequestException('Folder name is required');
    }
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (body.parentFolderId != null && !UUID_RE.test(body.parentFolderId)) {
      throw new BadRequestException('parentFolderId must be a valid UUID');
    }
    return this.service.createFolder(
      body.name,
      user.id,
      body.parentFolderId ?? null,
    );
  }

  @Delete('folders/:id')
  deleteFolder(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.deleteFolder(id, user.id);
  }

  @Post('folders/:id/files')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const unique = crypto.randomBytes(8).toString('hex');
          const safe = sanitizeFilename(file.originalname);
          cb(null, `${unique}-${safe}`);
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: uploadFileFilter,
    }),
  )
  uploadFiles(
    @Param('id') folderId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles() files: Express.Multer.File[],
    // Multer parses non-file fields onto the request body; multipart
    // strings come through verbatim. Service validates the value
    // against the 'all' | 'admins' | 'teams' | 'project' enum.
    //
    // teamIds / projectIds arrive as either a single string ("uuid")
    // or an array depending on how the FE serialized it
    // ("teamIds=a" vs. multiple `teamIds=a&teamIds=b` appends).
    // Normalize before passing on so the service only deals with
    // `string[]`.
    //
    // `nameConflictActions` is JSON-encoded by the FE — multipart
    // can't transport an object natively, so the FE stringifies and
    // the controller parses. Malformed JSON is silently dropped so a
    // garbage value doesn't blow up the upload; the service then
    // treats every name conflict as 'skip', i.e. surfaces it back
    // for the user to resolve.
    @Body()
    body: {
      visibility?: string;
      teamIds?: string | string[];
      projectIds?: string | string[];
      scheduleIds?: string | string[];
      nameConflictActions?: string;
    },
  ) {
    const teamIds = Array.isArray(body?.teamIds)
      ? body.teamIds
      : body?.teamIds
        ? [body.teamIds]
        : [];
    const projectIds = Array.isArray(body?.projectIds)
      ? body.projectIds
      : body?.projectIds
        ? [body.projectIds]
        : [];
    const scheduleIds = Array.isArray(body?.scheduleIds)
      ? body.scheduleIds
      : body?.scheduleIds
        ? [body.scheduleIds]
        : [];
    let nameConflictActions: Record<string, NameConflictAction> | undefined;
    if (body?.nameConflictActions) {
      try {
        const parsed: unknown = JSON.parse(body.nameConflictActions);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          nameConflictActions = {};
          for (const [key, value] of Object.entries(
            parsed as Record<string, unknown>,
          )) {
            if (
              typeof key === 'string' &&
              (value === 'overwrite' ||
                value === 'keep_both' ||
                value === 'skip')
            ) {
              nameConflictActions[key] = value;
            }
          }
        }
      } catch {
        // Fall through — undefined means service treats every name
        // conflict as 'skip' and bounces them back to the user.
      }
    }
    return this.service.uploadFiles(
      folderId,
      user.id,
      files,
      body?.visibility,
      teamIds,
      projectIds,
      nameConflictActions,
      scheduleIds,
    );
  }

  /**
   * Promote / demote a knowledge file between 'all' and 'admins'
   * visibility. Admin-only — the gate lives in the service so the
   * controller stays free of role-fetch logic. Mirrors the pattern
   * used by `models.controller` for admin endpoints.
   */
  @Patch('files/:id/visibility')
  updateFileVisibility(
    @Param('id') id: string,
    @Body()
    body: {
      visibility: string;
      teamIds?: string[];
      projectIds?: string[];
      scheduleIds?: string[];
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateFileVisibility(
      id,
      user.id,
      body?.visibility,
      body?.teamIds,
      body?.projectIds,
      body?.scheduleIds,
    );
  }

  /**
   * Force a fresh chunk + embed pass on a single file. Owner-only;
   * blocked if the file is currently mid-ingestion (status='processing').
   * Replaces the "upload a dummy file to kick the worker" workaround
   * users were doing when an earlier run finished with no chunks.
   */
  @Post('files/:id/reingest')
  reingestFile(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reingestFile(id, user.id);
  }

  /**
   * Wipe a file's embeddings without deleting the upload. Owner-only;
   * blocked if mid-ingestion. The row stays in KC (still listed,
   * still downloadable), but chat-time RAG won't surface it until
   * the owner triggers Retrain.
   */
  @Post('files/:id/untrain')
  untrainFile(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.untrainFile(id, user.id);
  }

  /**
   * Bulk variant of the per-file PATCH. Lets the multi-select action
   * bar flip many rows in one round-trip and one DB transaction.
   * Admin-only — same gate as the per-file endpoint, just applied
   * once for the whole batch.
   *
   * Mounted ahead of `:id/visibility` would clash; this route has
   * no `:id` segment so the order doesn't matter, but kept after
   * for readability.
   */
  @Patch('files/visibility')
  updateFilesVisibility(
    @Body()
    body: {
      fileIds: string[];
      visibility: string;
      teamIds?: string[];
      projectIds?: string[];
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateFilesVisibility(
      body?.fileIds ?? [],
      user.id,
      body?.visibility,
      body?.teamIds,
      body?.projectIds,
    );
  }

  @Get('files/:id/download')
  async downloadFile(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const file = await this.service.getFileForDownload(id, user.id);
    res.download(file.storagePath, file.name);
  }

  @Patch('files/:id/move')
  moveFile(
    @Param('id') id: string,
    @Body() body: { targetFolderId: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.moveFile(id, body.targetFolderId, user.id);
  }

  @Delete('files/:id')
  deleteFile(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.deleteFile(id, user.id);
  }

  @Get('recent')
  recentFiles(@CurrentUser() user: AuthenticatedUser) {
    return this.service.recentFiles(user.id);
  }

  // ────────────────────────────────────────────────────────────────
  // Google Drive import + Re-sync
  //
  // OAuth lifecycle + raw folder browsing live under /google-drive/*
  // (GoogleDriveController). These endpoints handle the Drive→KC
  // orchestration only — listing sources, importing, re-syncing,
  // detaching.
  // ────────────────────────────────────────────────────────────────

  /**
   * One-page file-count estimate for the import-dialog warning banner.
   * Fast (< 1 s for most users); `hasMore: true` means > 1 000 files.
   */
  @Get('drive/file-count')
  getDriveFileCount(@CurrentUser() user: AuthenticatedUser) {
    return this.driveImport.getFileCountEstimate(user.id);
  }

  /**
   * Pull files from the user's connected Drive into KC. Returns
   * `{ added, skippedDuplicates, ... }` so the FE can toast a
   * meaningful "Imported N new files" message.
   */
  @Post('drive/import')
  importFromDrive(
    @Body() body: ImportScope,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.driveImport.importFromDrive(user.id, body);
  }

  /**
   * Start an async "Entire Drive" import. Returns `{ started: true }`
   * immediately; poll `GET drive/import/progress` to track it.
   * Only `scope.kind === 'all'` is accepted — folder imports are fast
   * enough for the synchronous path.
   */
  @Post('drive/import/async')
  startDriveImportAsync(
    @Body() body: ImportScope,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.driveImport.startImportAllAsync(user.id, body);
  }

  /**
   * Poll the progress of the user's active async import.
   * Returns `{ progress: DriveImportProgress | null }`.
   */
  @Get('drive/import/progress')
  getDriveImportProgress(@CurrentUser() user: AuthenticatedUser) {
    return { progress: this.driveImport.getImportProgress(user.id) };
  }

  /**
   * Cancel the running async import and roll back all rows inserted
   * so far. Silently no-ops if no import is active.
   */
  @Delete('drive/import/active')
  async cancelDriveImport(@CurrentUser() user: AuthenticatedUser) {
    await this.driveImport.cancelImport(user.id);
    return { cancelled: true };
  }

  /** All Drive sources the user has imported, for the Re-sync UI. */
  @Get('drive/sources')
  listDriveSources(@CurrentUser() user: AuthenticatedUser) {
    return this.driveImport.listSources(user.id);
  }

  /**
   * Re-sync one source. Same logic as importFromDrive but scoped to
   * the source's Drive folder — only adds files that appeared on
   * Drive since the last sync.
   */
  @Post('drive/sources/:id/resync')
  resyncDriveSource(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.driveImport.resyncSource(user.id, id);
  }

  /**
   * Drop a source row. Imported files stay in KC — the user removes
   * them via the normal file delete path if they want a full cleanup.
   */
  @Delete('drive/sources/:id')
  async deleteDriveSource(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.driveImport.deleteSource(user.id, id);
    return { success: true };
  }

  // ────────────────────────────────────────────────────────────────
  // SharePoint import + Re-sync
  //
  // OAuth lifecycle + raw site/drive/folder browsing live under
  // /sharepoint/* (SharePointController). These endpoints handle the
  // SharePoint→KC orchestration only — listing sources, importing,
  // re-syncing, detaching.
  // ────────────────────────────────────────────────────────────────

  /**
   * Per-site file-count estimate for the whole-site import warning
   * banner. `siteId` is a Graph site identifier — opaque from our side.
   * Returns `{ count, hasMore }`; `hasMore: true` means the site
   * exceeds the safety cap and the FE shows a "+1000" hint.
   */
  @Get('sharepoint/sites/:siteId/file-count')
  getSharePointSiteFileCount(
    @Param('siteId') siteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sharepointImport.getFileCountEstimateForSite(user.id, siteId);
  }

  @Post('sharepoint/import')
  importFromSharePoint(
    @Body() body: SharePointImportScope,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sharepointImport.importFromSharePoint(user.id, body);
  }

  /**
   * Start an async whole-site import. Returns `{ started: true }`
   * immediately; poll `GET sharepoint/import/progress` to track it.
   */
  @Post('sharepoint/import/async')
  startSharePointImportAsync(
    @Body() body: SharePointImportScope,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sharepointImport.startImportSiteAsync(user.id, body);
  }

  @Get('sharepoint/import/progress')
  getSharePointImportProgress(@CurrentUser() user: AuthenticatedUser) {
    return { progress: this.sharepointImport.getImportProgress(user.id) };
  }

  @Delete('sharepoint/import/active')
  async cancelSharePointImport(@CurrentUser() user: AuthenticatedUser) {
    await this.sharepointImport.cancelImport(user.id);
    return { cancelled: true };
  }

  @Get('sharepoint/sources')
  listSharePointSources(@CurrentUser() user: AuthenticatedUser) {
    return this.sharepointImport.listSources(user.id);
  }

  @Post('sharepoint/sources/:id/resync')
  resyncSharePointSource(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sharepointImport.resyncSource(user.id, id);
  }

  @Delete('sharepoint/sources/:id')
  async deleteSharePointSource(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.sharepointImport.deleteSource(user.id, id);
    return { success: true };
  }

  // ────────────────────────────────────────────────────────────────
  // OneDrive import + Re-sync
  //
  // OAuth lifecycle + raw folder browsing live under /onedrive/*
  // (OneDriveController). These endpoints handle only the
  // OneDrive→KC orchestration — direct parallel of /drive/*.
  // ────────────────────────────────────────────────────────────────

  @Get('onedrive/file-count')
  getOneDriveFileCount(@CurrentUser() user: AuthenticatedUser) {
    return this.onedriveImport.getFileCountEstimate(user.id);
  }

  @Post('onedrive/import')
  importFromOneDrive(
    @Body() body: OneDriveImportScope,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.onedriveImport.importFromOneDrive(user.id, body);
  }

  @Post('onedrive/import/async')
  startOneDriveImportAsync(
    @Body() body: OneDriveImportScope,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.onedriveImport.startImportAllAsync(user.id, body);
  }

  @Get('onedrive/import/progress')
  getOneDriveImportProgress(@CurrentUser() user: AuthenticatedUser) {
    return { progress: this.onedriveImport.getImportProgress(user.id) };
  }

  @Delete('onedrive/import/active')
  async cancelOneDriveImport(@CurrentUser() user: AuthenticatedUser) {
    await this.onedriveImport.cancelImport(user.id);
    return { cancelled: true };
  }

  @Get('onedrive/sources')
  listOneDriveSources(@CurrentUser() user: AuthenticatedUser) {
    return this.onedriveImport.listSources(user.id);
  }

  @Post('onedrive/sources/:id/resync')
  resyncOneDriveSource(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.onedriveImport.resyncSource(user.id, id);
  }

  @Delete('onedrive/sources/:id')
  async deleteOneDriveSource(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.onedriveImport.deleteSource(user.id, id);
    return { success: true };
  }
}
