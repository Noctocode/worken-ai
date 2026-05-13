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
import { KnowledgeCoreService } from './knowledge-core.service.js';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'knowledge-core');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|\x00-\x1f]/g, '_');
}

@Controller('knowledge-core')
export class KnowledgeCoreController {
  constructor(private readonly service: KnowledgeCoreService) {}

  @Get('folders')
  findAllFolders(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findAllFolders(user.id);
  }

  @Get('folders/:id')
  findFolder(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findFolder(id, user.id);
  }

  @Post('folders')
  createFolder(
    @Body() body: { name: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      throw new BadRequestException('Folder name is required');
    }
    return this.service.createFolder(body.name, user.id);
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
      fileFilter: (_req, file, cb) => {
        // Allowlist must match what documents.service.parseFile +
        // KnowledgeIngestionService.ingestOneFile can actually handle.
        // Dropping legacy .doc (application/msword) — mammoth is
        // .docx-only, so accepting .doc here just guarantees a
        // "Skipped" badge later. Reject up front with a clearer
        // message instead.
        const allowedExt = /\.(pdf|docx|xlsx?|png|jpe?g)$/i;
        const allowedMime =
          /^(application\/(pdf|vnd\.openxmlformats|vnd\.ms-excel|octet-stream)|image\/(png|jpe?g))/i;
        if (
          !allowedExt.test(file.originalname) ||
          !allowedMime.test(file.mimetype)
        ) {
          cb(new BadRequestException(`Unsupported file type: ${file.originalname}`), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  uploadFiles(
    @Param('id') folderId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles() files: Express.Multer.File[],
    // Multer parses non-file fields onto the request body; multipart
    // strings come through verbatim. Service validates the value
    // against the 'all' | 'admins' | 'teams' enum.
    //
    // teamIds arrives as either a single string ("uuid") or an array
    // depending on how the FE serialized it ("teamIds=a" vs. multiple
    // `teamIds=a&teamIds=b` appends). Normalize before passing on so
    // the service only deals with `string[]`.
    @Body() body: { visibility?: string; teamIds?: string | string[] },
  ) {
    const teamIds = Array.isArray(body?.teamIds)
      ? body.teamIds
      : body?.teamIds
        ? [body.teamIds]
        : [];
    return this.service.uploadFiles(
      folderId,
      user.id,
      files,
      body?.visibility,
      teamIds,
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
    @Body() body: { visibility: string; teamIds?: string[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateFileVisibility(
      id,
      user.id,
      body?.visibility,
      body?.teamIds,
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
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateFilesVisibility(
      body?.fileIds ?? [],
      user.id,
      body?.visibility,
      body?.teamIds,
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
  deleteFile(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.deleteFile(id, user.id);
  }

  @Get('recent')
  recentFiles(@CurrentUser() user: AuthenticatedUser) {
    return this.service.recentFiles(user.id);
  }
}
